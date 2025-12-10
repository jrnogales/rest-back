// src/controllers/integracionController.js
import { listPaquetes, getPaqueteByCodigo } from '../models/paqueteModel.js';
import { ensureAndGetDisponibilidad } from '../models/disponibilidadModel.js';
import { crearReserva, cancelarReserva } from '../models/reservaModel.js';
import {
  crearFacturaParaReserva,
  crearFacturaParaLote
} from '../models/facturaModel.js';
import { pool } from '../config/db.js';
import { reembolsarPagoBanco } from '../services/bancoService.js';

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

// 🌐 Pago con banco externo
const BANK_BASE_URL = 'http://mibanca.runasp.net/api/transacciones'; // usa cuentaDestino 299

/**
 * POST /api/v1/integracion/pagos
 * Body: { cuentaOrigen, monto }
 */
export async function procesarPago(req, res) {
  try {
    const { cuentaOrigen, monto } = req.body || {};

    if (!cuentaOrigen || !monto) {
      return res
        .status(400)
        .json({ ok: false, error: 'cuentaOrigen y monto son requeridos' });
    }

    const payload = {
      cuentaOrigen: String(cuentaOrigen),
      cuentaDestino: '299',              // 👈 tu cuenta destino fija
      tipo: 'C',                         // C = crédito en la cuenta destino
      monto: Number(monto),
      referencia: 'CUENCA-TRAVEL',
      canal: 'WEB',
      descripcion: 'Pago paquetes turísticos'
    };

    // Node 20 ya tiene fetch global, no hace falta import
    const resp = await fetch(BANK_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }

    if (!resp.ok) {
      const msg =
        data?.mensaje ||
        data?.error ||
        `Error al procesar pago en el banco (HTTP ${resp.status})`;

      console.error('[procesarPago] error banco:', msg, data);
      return res.status(502).json({ ok: false, error: msg });
    }

    // Aquí devolvemos lo que el banco responda
    return res.status(201).json({
      ok: true,
      data
    });
  } catch (err) {
    console.error('[procesarPago] error interno:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
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
 *
 * MODO CARRITO:
 *   body = { items: [ { codigo, fecha, adultos, ninos, usuarioId }, ... ] }
 *   → Crea varias reservas y UNA sola factura (crearFacturaParaLote).
 *
 * MODO SIMPLE:
 *   body = { item: { codigo, fecha, adultos, ninos, usuarioId } }
 *   → Crea una reserva y su factura individual (crearFacturaParaReserva).
 */
export async function confirmarReserva(req, res) {
  try {
    const body = req.body || {};

    // --- MODO CARRITO: varias reservas, CADA UNA con su factura ---
if (Array.isArray(body.items) && body.items.length > 0) {
  const items = body.items;
  const reservas = [];
  let totalCarrito = 0;
  let ultimaFacturaCodigo = null;

  for (const it of items) {
    const {
      codigo,
      fecha,
      adultos = 1,
      ninos = 0,
      usuarioId = null
    } = it || {};

    if (!codigo || !fecha) {
      throw new Error('Cada item necesita código y fecha');
    }

    // 1) Crear la reserva
    const r = await crearReserva({
      codigo,
      fecha,
      adultos,
      ninos,
      usuarioId,
      origen: 'WEB'
    });

    // 2) Crear FACTURA INDIVIDUAL para ESTA reserva
    const fac = await crearFacturaParaReserva({
      codigoReserva: r.codigoReserva
    });

    ultimaFacturaCodigo = fac.codigoFactura; // nos guardamos el código de la última

    reservas.push(r);
    totalCarrito += Number(r.total || r.total_usd || 0);
  }

  // Esto se usa solo para mostrar algo en el comprobante del carrito
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


    // --- MODO SIMPLE: una reserva + una factura ---
    const { item } = body;
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
      usuarioId = null // 👈 VIENE DEL FRONT
    } = item;

    if (!codigo || !fecha) {
      return res
        .status(400)
        .json({ ok: false, error: 'Faltan código o fecha' });
    }

    console.log('[REST] confirmarReserva item =', item);

    // 1) Crear reserva en DB (ya con usuario_id y descuento de stock)
    const reserva = await crearReserva({
      codigo,
      fecha,
      adultos,
      ninos,
      usuarioId,
      origen: 'WEB'
    });

    // 2) Crear factura + detalle_factura (una sola reserva)
    await crearFacturaParaReserva(reserva);

    return res.status(201).json({
      ok: true,
      data: {
        bookingId: reserva.codigoReserva,
        total: reserva.total_usd ?? reserva.total,
        estado: reserva.estado || 'CONFIRMADA'
      }
    });
  } catch (err) {
    console.error('[confirmarReserva] error', err);
    return res.status(500).json({ ok: false, error: err.message });
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

/**
 * POST /api/v1/integracion/cancelar-con-reembolso
 *
 * Body: {
 *   bookingId: "RES-20251210-ABCD",
 *   cuentaDestino: "301"
 * }
 *
 * Reglas:
 *  - Solo se puede cancelar si falta al menos 1 día (fecha_viaje > HOY).
 *  - Si la reserva ya está en la fecha de viaje (mismo día) o pasada → 400.
 *  - Marca reserva como CANCELADA (y devuelve cupos).
 *  - Marca la factura como ANULADA.
 *  - Hace un movimiento bancario 299 → cuentaDestino por el total.
 */
export async function cancelarConReembolso(req, res) {
  try {
    const { bookingId, cuentaDestino } = req.body || {};
    const codigo = String(bookingId || '').trim();

    if (!codigo || !cuentaDestino) {
      return res.status(400).json({
        ok: false,
        error: 'bookingId y cuentaDestino son requeridos'
      });
    }

    // 1) Buscar reserva + factura asociada
    const { rows } = await pool.query(
      `
      SELECT
        r.id              AS reserva_id,
        r.codigo_reserva,
        r.fecha_viaje,
        COALESCE(r.total_usd, 0)         AS total_reserva,
        COALESCE(r.estado, 'CONFIRMADA') AS estado_reserva,
        f.id              AS factura_id,
        COALESCE(f.total, 0)             AS total_factura,
        COALESCE(f.estado, 'EMITIDA')    AS estado_factura
      FROM reservas r
      LEFT JOIN facturas f ON f.reserva_id = r.id
      WHERE r.codigo_reserva = $1
      LIMIT 1
      `,
      [codigo]
    );

    const row = rows[0];
    if (!row) {
      return res.status(404).json({
        ok: false,
        error: 'Reserva no encontrada'
      });
    }

    // 2) Validar estados actuales
    if (row.estado_reserva === 'CANCELADA') {
      return res.status(409).json({
        ok: false,
        error: 'La reserva ya está cancelada'
      });
    }

    if (row.factura_id && row.estado_factura === 'ANULADA') {
      return res.status(409).json({
        ok: false,
        error: 'La factura asociada ya está anulada'
      });
    }

    // 3) Política de tiempo (24 horas antes del viaje)
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const d = hoy.getDate();
    const inicioHoy = new Date(y, m, d, 0, 0, 0, 0); // 00:00 hoy

    const fechaViaje = new Date(row.fecha_viaje);
    const y2 = fechaViaje.getFullYear();
    const m2 = fechaViaje.getMonth();
    const d2 = fechaViaje.getDate();
    const inicioViaje = new Date(y2, m2, d2, 0, 0, 0, 0);

    if (inicioViaje.getTime() <= inicioHoy.getTime()) {
      return res.status(400).json({
        ok: false,
        error:
          'No se puede cancelar la reserva el mismo día del viaje o después. ' +
          'Las cancelaciones deben hacerse con al menos 24 horas de anticipación.'
      });
    }

    // 4) Monto a devolver
    //    Si hay factura → devolvemos lo que se cobró (total_factura).
    //    Si no tiene factura (caso raro) → usamos total_reserva.
    const monto = Number(row.total_factura || row.total_reserva || 0);

    if (!monto || !Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'No hay un monto válido para reembolsar'
      });
    }

    // 5) Reembolso bancario (inverso al pago original)
    //    Pago original: realizarPagoBanco({ cuentaOrigen, monto }) → cliente → 299
    //    Reembolso:     reembolsarPagoBanco({ cuentaDestino, monto }) → 299 → cliente
    const pagoBanco = await reembolsarPagoBanco({
      cuentaDestino,
      monto
    });

    // 6) Actualizar la reserva y la disponibilidad (devuelve stock)
    //    reutilizamos la lógica de modelo cancelarReserva
    await cancelarReserva(codigo);

    // 7) Marcar factura como ANULADA (si existe)
    if (row.factura_id) {
      await pool.query(
        `
        UPDATE facturas
           SET estado = 'ANULADA'
         WHERE id = $1
        `,
        [row.factura_id]
      );
    }

    // 8) Respuesta final
    return res.status(200).json({
      ok: true,
      bookingId: codigo,
      reembolso: {
        cuentaDestino,
        monto,
        banco: pagoBanco
      }
    });
  } catch (err) {
    console.error('[cancelarConReembolso] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}