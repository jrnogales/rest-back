// src/controllers/integracionController.js
import { listPaquetes, getPaqueteByCodigo } from '../models/paqueteModel.js';
import { ensureAndGetDisponibilidad } from '../models/disponibilidadModel.js';
import { crearReserva, cancelarReserva } from '../models/reservaModel.js';
import { crearFacturaParaReserva } from '../models/facturaModel.js';

// ✅ misma versión que en server.js
const API_VERSION = 'v1';
const API_BASE = `/api/${API_VERSION}/integracion`;

// 🔧 helper para errores → asigna 400, 404, 409 o 500 según el mensaje
function handleError(res, err) {
  const msg = err?.message || String(err);

  if (/no encontrado|no existe|sku inválido/i.test(msg)) {
    return res.status(404).json({ ok: false, error: msg });
  }
  if (/requerid|inválid|formato/i.test(msg)) {
    return res.status(400).json({ ok: false, error: msg });
  }
  if (/stock insuficiente|conflict/i.test(msg)) {
    return res.status(409).json({ ok: false, error: msg });
  }

  console.error('[API ERROR]', err);
  return res.status(500).json({ ok: false, error: msg });
}

// 🔧 helper para links de un paquete
function buildPaqueteLinks(codigo) {
  const safeCode = encodeURIComponent(String(codigo));
  return {
    self: {
      href: `${API_BASE}/paquetes/${safeCode}`,
      method: 'GET'
    },
    disponibilidad: {
      href: `${API_BASE}/paquetes/availability?sku=${safeCode}&inicio={YYYY-MM-DD}&unidades={n}`,
      method: 'GET'
    },
    cotizar: {
      href: `${API_BASE}/paquetes/quote`,
      method: 'POST'
    },
    reservar: {
      href: `${API_BASE}/paquetes/book`,
      method: 'POST'
    }
  };
}

/**
 * GET /api/v1/integracion/paquetes/search
 * Lista paquetes (con filtro opcional por precio) + HATEOAS
 */
export async function buscarServicios(req, res) {
  try {
    const min = req.query.minPrecio ? Number(req.query.minPrecio) : null;
    const max = req.query.maxPrecio ? Number(req.query.maxPrecio) : null;

    const rows = (await listPaquetes()).map((p) => {
      const item = {
        id: String(p.codigo),
        name: p.titulo,
        adultPrice: Number(p.precio_adulto || 0),
        childPrice: Number(p.precio_nino || 0),
        currency: p.currency || 'USD',
        durationDays: Number(p.duracion_dias || 1),
        agencyName: p.agency_name || 'cuenca-travel',
        imageUrl: p.imagen || '',
        description: String(p.descripcion || ''),
        stock: Number(p.stock || 0)
      };
      return {
        ...item,
        _links: buildPaqueteLinks(p.codigo)
      };
    });

    const data = rows.filter(
      (s) =>
        (min === null || s.adultPrice >= min) &&
        (max === null || s.adultPrice <= max)
    );

    return res.status(200).json({
      ok: true,
      data,
      _links: {
        self: { href: `${API_BASE}/paquetes/search`, method: 'GET' }
      }
    });
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * GET /api/v1/integracion/paquetes/:id
 * Detalle de un paquete + HATEOAS
 */
export async function obtenerDetalleServicio(req, res) {
  try {
    const p = await getPaqueteByCodigo(req.params.id);
    if (!p) {
      return res
        .status(404)
        .json({ ok: false, error: 'Servicio no encontrado' });
    }

    const servicio = {
      id: String(p.codigo),
      name: p.titulo,
      adultPrice: Number(p.precio_adulto || 0),
      childPrice: Number(p.precio_nino || 0),
      currency: p.currency || 'USD',
      durationDays: Number(p.duracion_dias || 1),
      agencyName: p.agency_name || 'cuenca-travel',
      imageUrl: p.imagen || '',
      description: String(p.descripcion || ''),
      stock: Number(p.stock || 0),
      _links: buildPaqueteLinks(p.codigo)
    };

    return res.status(200).json({
      ok: true,
      data: servicio
    });
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * GET /api/v1/integracion/paquetes/availability
 * Verifica disponibilidad + HATEOAS
 */
export async function verificarDisponibilidad(req, res) {
  try {
    const sku = String(req.query.sku || '').trim();
    const inicio = String(req.query.inicio || '').slice(0, 10);
    const unidades = Math.max(0, parseInt(req.query.unidades || '0', 10));

    if (!sku || !inicio) {
      return res
        .status(400)
        .json({ ok: false, error: 'sku e inicio son requeridos' });
    }

    const p = await getPaqueteByCodigo(sku);
    if (!p) {
      return res.status(404).json({ ok: false, error: 'SKU inválido' });
    }

    const disp = await ensureAndGetDisponibilidad(p.id, inicio);
    if (!disp) {
      return res
        .status(400)
        .json({ ok: false, error: 'No se pudo leer disponibilidad' });
    }

    const libres =
      Number(disp.cupos_totales) - Number(disp.cupos_reservados);

    return res.status(200).json({
      ok: libres >= unidades,
      data: {
        sku,
        inicio,
        solicitadas: unidades,
        libres
      },
      _links: {
        self: {
          href: `${API_BASE}/paquetes/availability?sku=${encodeURIComponent(
            sku
          )}&inicio=${inicio}&unidades=${unidades}`,
          method: 'GET'
        },
        reservar: {
          href: `${API_BASE}/paquetes/book`,
          method: 'POST'
        },
        cotizar: {
          href: `${API_BASE}/paquetes/quote`,
          method: 'POST'
        }
      }
    });
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * POST /api/v1/integracion/paquetes/quote
 * Cotiza una reserva (no guarda nada) + HATEOAS
 */
export async function cotizarReserva(req, res) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    let total = 0;
    const detail = [];

    for (const it of items) {
      const p = await getPaqueteByCodigo(String(it.codigo || ''));
      if (!p) continue;
      const ad = Math.max(0, parseInt(it.adultos || '0', 10));
      const ni = Math.max(0, parseInt(it.ninos || '0', 10));
      const subt =
        ad * Number(p.precio_adulto || 0) +
        ni * Number(p.precio_nino || 0);
      total += subt;
      detail.push({ codigo: p.codigo, subtotal: +subt.toFixed(2) });
    }

    return res.status(200).json({
      ok: true,
      data: {
        total: +total.toFixed(2),
        breakdown: detail
      },
      _links: {
        self: { href: `${API_BASE}/paquetes/quote`, method: 'POST' },
        reservar: { href: `${API_BASE}/paquetes/book`, method: 'POST' }
      }
    });
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * POST /api/v1/integracion/paquetes/hold
 * Crea una pre-reserva temporal + HATEOAS
 */
export async function crearPreReserva(req, res) {
  try {
    const preBookingId =
      'PRE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const expiraEn = new Date(Date.now() + 10 * 60000).toISOString();

    return res.status(201).json({
      ok: true,
      data: {
        preBookingId,
        expiraEn
      },
      _links: {
        self: { href: `${API_BASE}/paquetes/hold`, method: 'POST' },
        confirmar: { href: `${API_BASE}/paquetes/book`, method: 'POST' }
      }
    });
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * POST /api/v1/integracion/paquetes/book
 * Confirma una reserva real + HATEOAS
 */
export async function confirmarReserva(req, res) {
  try {
    console.log('[REST confirmarReserva] body =', req.body);

    const item = req.body?.item;
    if (!item) {
      return res
        .status(400)
        .json({ ok: false, error: 'Falta item en el body' });
    }

    const {
      codigo,
      fecha,
      adultos = 1,
      ninos = 0,
      usuarioId = null  // 👈 VIENE DEL FRONT
    } = item;

    if (!codigo || !fecha) {
      return res
        .status(400)
        .json({ ok: false, error: 'Faltan código o fecha' });
    }

    console.log('[REST confirmarReserva] usuarioId =', usuarioId);

    // 1) Crear reserva en DB (ya con usuario_id y descuento de stock)
    const reserva = await crearReserva({
      codigo,
      fecha,
      adultos,
      ninos,
      usuarioId,
      origen: 'WEB'
    });

    console.log('[REST confirmarReserva] reserva creada =', reserva);

    // 2) Crear factura + detalle_factura
    await crearFacturaParaReserva(reserva);

    return res.status(201).json({
      ok: true,
      data: {
        bookingId: reserva.codigoReserva,
        total: reserva.total,
        estado: reserva.estado || 'CONFIRMADA'
      }
    });
  } catch (err) {
    console.error('[confirmarReserva] error', err);
    return handleError(res, err);
  }
}

/**
 * DELETE /api/v1/integracion/paquetes/book/:bookingId
 * ó POST /api/v1/integracion/paquetes/cancel (compatibilidad)
 * Cancela una reserva → 204 No Content
 */
export async function cancelarReservaIntegracion(req, res) {
  try {
    const bookingIdParam = req.params.bookingId;
    const bookingIdBody = req.body?.bookingId;
    const bookingId = String(bookingIdParam || bookingIdBody || '').trim();

    if (!bookingId) {
      return res
        .status(400)
        .json({ ok: false, error: 'bookingId requerido' });
    }

    await cancelarReserva(bookingId);

    // 204 No Content (DELETE exitoso según la tabla del profe)
    return res.status(204).end();
  } catch (e) {
    return handleError(res, e);
  }
}
