// src/controllers/integracionController.js
import { listPaquetes, getPaqueteByCodigo } from '../models/paqueteModel.js';
import { ensureAndGetDisponibilidad } from '../models/disponibilidadModel.js';
import { crearReserva, cancelarReserva, getReservaPorCodigo } from '../models/reservaModel.js';
import { crearFacturaParaReserva, getFacturaByReservaId, anularFactura } from '../models/facturaModel.js';
import { reembolsarPagoBanco } from '../services/bancoService.js';

// ✅ misma versión que en server.js
const API_VERSION = 'v1';
const API_BASE = `/api/${API_VERSION}/integracion`;

// 🔧 helper errores
function handleError(res, err) {
  const msg = err?.message || String(err);

  if (/no encontrado|no existe|sku inválido/i.test(msg)) {
    return res.status(404).json({ ok: false, error: msg });
  }
  if (/requerid|inválid|formato|faltan/i.test(msg)) {
    return res.status(400).json({ ok: false, error: msg });
  }
  if (/stock insuficiente|conflict|cupos/i.test(msg)) {
    return res.status(409).json({ ok: false, error: msg });
  }

  console.error('[API ERROR]', err);
  return res.status(500).json({ ok: false, error: msg });
}

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
      return { ...item, _links: buildPaqueteLinks(p.codigo) };
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
 */
export async function obtenerDetalleServicio(req, res) {
  try {
    const p = await getPaqueteByCodigo(req.params.id);
    if (!p) {
      return res.status(404).json({ ok: false, error: 'Servicio no encontrado' });
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

    return res.status(200).json({ ok: true, data: servicio });
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * GET /api/v1/integracion/paquetes/availability
 */
export async function verificarDisponibilidad(req, res) {
  try {
    const sku = String(req.query.sku || '').trim();
    const inicio = String(req.query.inicio || '').slice(0, 10);
    const unidades = Math.max(0, parseInt(req.query.unidades || '0', 10));

    if (!sku || !inicio) {
      return res.status(400).json({ ok: false, error: 'sku e inicio son requeridos' });
    }

    const p = await getPaqueteByCodigo(sku);
    if (!p) {
      return res.status(404).json({ ok: false, error: 'SKU inválido' });
    }

    // En DB separada: disponibilidad se maneja por paquete_codigo (no paquete_id)
    const disp = await ensureAndGetDisponibilidad(p.codigo, inicio);
    if (!disp) {
      return res.status(400).json({ ok: false, error: 'No se pudo leer disponibilidad' });
    }

    const libres = Number(disp.cupos_totales) - Number(disp.cupos_reservados);

    return res.status(200).json({
      ok: libres >= unidades,
      data: { sku, inicio, solicitadas: unidades, libres },
      _links: {
        self: {
          href: `${API_BASE}/paquetes/availability?sku=${encodeURIComponent(sku)}&inicio=${inicio}&unidades=${unidades}`,
          method: 'GET'
        },
        reservar: { href: `${API_BASE}/paquetes/book`, method: 'POST' },
        cotizar: { href: `${API_BASE}/paquetes/quote`, method: 'POST' }
      }
    });
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * POST /api/v1/integracion/paquetes/quote
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
      data: { total: +total.toFixed(2), breakdown: detail },
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
 */
export async function crearPreReserva(req, res) {
  try {
    const preBookingId = 'PRE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const expiraEn = new Date(Date.now() + 10 * 60000).toISOString();

    return res.status(201).json({
      ok: true,
      data: { preBookingId, expiraEn },
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
 * - MODO CARRITO: body.items[]
 * - MODO SIMPLE: body.item
 */
export async function confirmarReserva(req, res) {
  try {
    const body = req.body || {};

    // --- MODO CARRITO: varias reservas, cada una con su factura ---
    if (Array.isArray(body.items) && body.items.length > 0) {
      const items = body.items;
      const reservas = [];
      let totalCarrito = 0;
      let ultimaFacturaCodigo = null;

      for (const it of items) {
        const { codigo, fecha, adultos = 1, ninos = 0, usuarioId = null } = it || {};
        if (!codigo || !fecha) throw new Error('Cada item necesita código y fecha');

        // 1) Crear reserva (DB reservas + snapshot de paquete)
        const r = await crearReserva({
          codigo,
          fecha,
          adultos,
          ninos,
          usuarioId,
          origen: 'WEB'
        });

        // 2) Crear factura (DB facturas, leyendo reserva en DB reservas)
        const fac = await crearFacturaParaReserva({ codigoReserva: r.codigoReserva });
        ultimaFacturaCodigo = fac.codigoFactura;

        reservas.push(r);
        totalCarrito += Number(r.total || r.total_usd || 0);
      }

      const referencia = ultimaFacturaCodigo || reservas[0]?.codigoReserva || 'CARRITO';

      return res.status(201).json({
        ok: true,
        data: {
          bookingId: referencia,
          reservas: reservas.map(r => r.codigoReserva),
          total: +totalCarrito.toFixed(2),
          estado: 'CONFIRMADA'
        }
      });
    }

    // --- MODO SIMPLE ---
    const { item } = body;
    if (!item) {
      return res.status(400).json({ ok: false, error: 'Falta item en el body' });
    }

    const { codigo, fecha, adultos = 1, ninos = 0, usuarioId = null } = item;
    if (!codigo || !fecha) {
      return res.status(400).json({ ok: false, error: 'Faltan código o fecha' });
    }

    // 1) Crear reserva
    const reserva = await crearReserva({
      codigo,
      fecha,
      adultos,
      ninos,
      usuarioId,
      origen: 'WEB'
    });

    // 2) Crear factura
    await crearFacturaParaReserva({ codigoReserva: reserva.codigoReserva });

    return res.status(201).json({
      ok: true,
      data: {
        bookingId: reserva.codigoReserva,
        total: reserva.total_usd ?? reserva.total,
        estado: reserva.estado || 'CONFIRMADA'
      }
    });
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * DELETE /api/v1/integracion/paquetes/book/:bookingId
 * ó POST /api/v1/integracion/paquetes/cancel
 * → 204
 */
export async function cancelarReservaIntegracion(req, res) {
  try {
    const bookingIdParam = req.params.bookingId;
    const bookingIdBody = req.body?.bookingId;
    const bookingId = String(bookingIdParam || bookingIdBody || '').trim();

    if (!bookingId) {
      return res.status(400).json({ ok: false, error: 'bookingId requerido' });
    }

    await cancelarReserva(bookingId);
    return res.status(204).end();
  } catch (e) {
    return handleError(res, e);
  }
}

/**
 * POST /api/v1/integracion/cancelar-con-reembolso
 */
export async function cancelarConReembolso(req, res) {
  try {
    const { bookingId, cuentaDestino } = req.body || {};
    const codigo = String(bookingId || '').trim();

    if (!codigo || !cuentaDestino) {
      return res.status(400).json({ ok: false, error: 'bookingId y cuentaDestino son requeridos' });
    }

    // 1) Reserva (DB reservas)
    const reserva = await getReservaPorCodigo(codigo);
    if (!reserva) {
      return res.status(404).json({ ok: false, error: 'Reserva no encontrada' });
    }

    if (String(reserva.estado || '').toUpperCase() === 'CANCELADA') {
      return res.status(409).json({ ok: false, error: 'La reserva ya está cancelada' });
    }

    // 2) Política de tiempo: debe ser al menos 24h antes
    const hoy = new Date();
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0, 0);

    const fechaViaje = new Date(reserva.fecha_viaje);
    const inicioViaje = new Date(fechaViaje.getFullYear(), fechaViaje.getMonth(), fechaViaje.getDate(), 0, 0, 0, 0);

    if (inicioViaje.getTime() <= inicioHoy.getTime()) {
      return res.status(400).json({
        ok: false,
        error:
          'No se puede cancelar la reserva el mismo día del viaje o después. ' +
          'Las cancelaciones deben hacerse con al menos 24 horas de anticipación.'
      });
    }

    // 3) Factura asociada (DB facturas)
    const factura = await getFacturaByReservaId(reserva.id);
    if (factura && String(factura.estado || '').toUpperCase() === 'ANULADA') {
      return res.status(409).json({ ok: false, error: 'La factura asociada ya está anulada' });
    }

    // 4) Monto a devolver
    const monto = Number(factura?.total ?? reserva.total_usd ?? 0);
    if (!monto || !Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ ok: false, error: 'No hay un monto válido para reembolsar' });
    }

    // 5) Reembolso banco
    const pagoBanco = await reembolsarPagoBanco({ cuentaDestino, monto });

    // 6) Cancelar reserva (devuelve cupos)
    await cancelarReserva(codigo);

    // 7) Anular factura si existe
    if (factura?.id) {
      await anularFactura(factura.id);
    }

    return res.status(200).json({
      ok: true,
      bookingId: codigo,
      reembolso: { cuentaDestino, monto, banco: pagoBanco }
    });
  } catch (e) {
    return handleError(res, e);
  }
}
