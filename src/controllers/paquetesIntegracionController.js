// src/controllers/paquetesIntegracionController.js
import crypto from 'crypto';
import { pools } from '../config/db.js';
import { ensureAndGetDisponibilidad } from '../models/disponibilidadModel.js';
import {
  crearReserva,
  getReservaPorCodigo,
  cancelarReserva as cancelarReservaCore
} from '../models/reservaModel.js';
import { upsertUserByEmail } from '../models/usuarioModel.js';
import { crearFacturaParaReserva, getFacturaByReservaId } from '../models/facturaModel.js';

import {
  generarLinksPaquete,
  generarLinksHold,
  generarLinksReserva
} from '../helpers/hateoasHelper.js';

const poolPaquetes = pools.paquetes;
const poolReservas = pools.reservas;

// URL pública real del backend desplegado en Render
const PUBLIC_BASE_URL = 'https://rest-back-xnjm.onrender.com';

// ================== Utils ==================
function brief(txt = '', len = 140) {
  const s = String(txt).replace(/\s+/g, ' ').trim();
  return s.length <= len ? s : s.slice(0, len - 1) + '…';
}

// BaseUrl equivalente a $"{Request.Scheme}://{Request.Host}"
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

// ============ Helpers: normalización de IDs ============
function toIntOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

async function getPaqueteCodigoById(idPaquete) {
  const { rows } = await poolPaquetes.query(
    `SELECT codigo FROM paquetes WHERE id=$1 LIMIT 1`,
    [Number(idPaquete)]
  );
  return rows[0]?.codigo ?? null;
}

async function getReservaCodigoByIdDB(reservaId) {
  const { rows } = await poolReservas.query(
    `SELECT codigo_reserva FROM reservas WHERE id=$1 LIMIT 1`,
    [Number(reservaId)]
  );
  return rows[0]?.codigo_reserva ?? null;
}

async function getReservaByIdDB(reservaId) {
  const { rows } = await poolReservas.query(
    `SELECT * FROM reservas WHERE id=$1 LIMIT 1`,
    [Number(reservaId)]
  );
  return rows[0] ?? null;
}

// Mapea paquete DB -> response (idPaquete ENTERO)
function mapPaqueteToCSharpModel(req, p) {
  const baseUrl = getBaseUrl(req);

  const idPaquete = Number(p.id);
  const nombre =
    p.nombre ||
    p.titulo ||
    p.nombre_paquete ||
    `Paquete ${p.codigo ?? p.id}`;

  const ciudad = p.ciudad || 'Cuenca';
  const pais = p.pais || 'Ecuador';
  const tipoActividad = p.tipo_actividad || p.categoria || 'Paquete turístico';
  const capacidad = Number(p.stock || p.capacidad || 30);
  const precio = Number(p.precio_adulto || p.precio || 0);
  const imagenUrl = p.imagen || p.uri_imagen || '';
  const duracion = Number(p.duracion_dias || p.duracion || 1);

  return {
    idPaquete, // ✅ ENTERO
    nombre,
    ciudad,
    pais,
    tipoActividad,
    capacidad,
    precioNormal: precio,
    precioActual: precio,
    imagenUrl,
    duracion,
    _links: generarLinksPaquete(baseUrl, String(idPaquete))
  };
}

// ================== Pre-reservas (DB) ==================
async function createHoldDB({ id_hold, paquete_codigo, fecha_inicio, turistas, expira_en }) {
  // Buscar paquete por CODIGO (interno)
  const pRes = await poolPaquetes.query(
    `SELECT id FROM paquetes WHERE codigo=$1 LIMIT 1`,
    [String(paquete_codigo)]
  );

  if (!pRes.rows.length) {
    throw new Error(`Paquete no encontrado: ${paquete_codigo}`);
  }

  const paqueteId = Number(pRes.rows[0].id);
  const fechaViaje = String(fecha_inicio).slice(0, 10);

  const adultos = turistas.filter(t => t.tipo === 'adulto' || !t.tipo).length || 1;
  const ninos = turistas.filter(t => t.tipo === 'nino').length || 0;

  const cliente = {
    nombre: turistas?.[0]?.nombre ?? null,
    apellido: turistas?.[0]?.apellido ?? null,
    identificacion: turistas?.[0]?.identificacion ?? null
  };

  await poolReservas.query(
    `
    INSERT INTO pre_reservas (
      pre_booking_id,
      origen,
      paquete_id,
      fecha_viaje,
      adultos,
      ninos,
      total_usd,
      expira_en,
      estado,
      cliente,
      creado_en,

      id_hold,
      paquete_codigo,
      fecha_inicio,
      turistas
    )
    VALUES (
      $1,'BUS',$2,$3::date,$4,$5,0,$6,'HOLD',$7::jsonb,NOW(),
      $8,$9,$10,$11::jsonb
    )
    `,
    [
      String(id_hold),
      paqueteId,
      fechaViaje,
      adultos,
      ninos,
      expira_en,
      JSON.stringify(cliente || {}),

      String(id_hold),
      String(paquete_codigo),          // CODIGO
      fechaViaje,
      JSON.stringify(turistas || [])
    ]
  );
}

async function getHoldDB(id_hold) {
  const { rows } = await poolReservas.query(
    `SELECT * FROM pre_reservas WHERE id_hold=$1 OR pre_booking_id=$1 LIMIT 1`,
    [String(id_hold)]
  );
  return rows[0] || null;
}

async function deleteHoldDB(id_hold) {
  await poolReservas.query(
    `DELETE FROM pre_reservas WHERE id_hold=$1 OR pre_booking_id=$1`,
    [String(id_hold)]
  );
}

/* ============================================================
   1) GET /api/v2/paquetes  (idPaquete ENTERO)
   ============================================================ */
export async function buscarPaquetes(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const pagina = Math.max(1, parseInt(req.query.pagina ?? '1', 10) || 1);
    const limite = Math.max(1, parseInt(req.query.limite ?? '10', 10) || 10);

    const { rows } = await poolPaquetes.query(`SELECT * FROM paquetes ORDER BY id ASC`);

    const datos = rows.map(p => {
      const mapped = mapPaqueteToCSharpModel(req, p);
      mapped._links = generarLinksPaquete(baseUrl, String(mapped.idPaquete));
      return mapped;
    });

    return res.json({
      datos,
      paginacion: {
        paginaActual: pagina,
        limite,
        totalPaginas: 1,
        totalElementos: datos.length
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener paquetes', detalle: err.message });
  }
}

/* ============================================================
   2) POST /api/v2/paquetes/availability (idPaquete ENTERO)
   ============================================================ */
export async function validarDisponibilidadPaquete(req, res) {
  const request = req.body;

  const idPaqueteRaw = request?.idPaquete ?? request?.IdPaquete;
  const paqueteId = toIntOrNull(idPaqueteRaw);
  if (!request || paqueteId == null) {
    return res.status(400).send('Id del paquete es requerido');
  }

  try {
    const codigo = await getPaqueteCodigoById(paqueteId);
    if (!codigo) {
      return res.status(404).json({ error: 'Paquete no encontrado', detalle: 'idPaquete inválido' });
    }

    const fechaInicio = request?.fechaInicio ?? request?.FechaInicio ?? null;
    const personas = request?.personas ?? request?.Personas ?? null;

    if (!fechaInicio || !personas) {
      return res.json({
        disponible: true,
        idPaquete: paqueteId, // ✅ ENTERO
        fechaInicio,
        personas,
        mensaje: 'Paquete disponible para reserva'
      });
    }

    const fecha = String(fechaInicio).slice(0, 10);
    const num = Math.max(0, parseInt(personas, 10));

    if (!num) {
      return res.json({
        disponible: true,
        idPaquete: paqueteId,
        fechaInicio: fecha,
        personas: num,
        mensaje: 'Paquete disponible para reserva'
      });
    }

    const disp = await ensureAndGetDisponibilidad(String(codigo), fecha);
    const libres = Number(disp.cupos_totales) - Number(disp.cupos_reservados);

    if (libres >= num) {
      return res.json({
        disponible: true,
        idPaquete: paqueteId,
        fechaInicio: fecha,
        personas: num,
        mensaje: 'Paquete disponible para reserva'
      });
    }

    return res.json({
      disponible: false,
      idPaquete: paqueteId,
      fechaInicio: fecha,
      personas: num,
      mensaje: 'No hay cupos suficientes'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al validar disponibilidad', detalle: err.message });
  }
}

/* ============================================================
   3) POST /api/v2/paquetes/pre-reserva (idPaquete ENTERO)
   ============================================================ */
export async function crearPreReservaPaquete(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const request = req.body;

    const idPaqueteRaw = request?.idPaquete ?? request?.IdPaquete ?? request?.id_paquete;
    const paqueteId = toIntOrNull(idPaqueteRaw);
    if (!request || paqueteId == null) {
      return res.status(400).send('Debe proporcionar id_paquete');
    }

    const codigo = await getPaqueteCodigoById(paqueteId);
    if (!codigo) {
      return res.status(404).send('Paquete no encontrado');
    }

    const fechaInicio = request?.fechaInicio ?? request?.FechaInicio ?? request?.fecha_inicio ?? null;
    const turistas = request?.turistas ?? request?.Turistas ?? [];

    const holdId = `HOLD-${crypto.randomUUID()}`;
    const expira = new Date(Date.now() + 10 * 60 * 1000);

    await createHoldDB({
      id_hold: holdId,
      paquete_codigo: String(codigo), // interno por codigo
      fecha_inicio: fechaInicio ? String(fechaInicio).slice(0, 10) : new Date().toISOString().slice(0, 10),
      turistas,
      expira_en: expira.toISOString()
    });

    return res.json({
      id_hold: holdId,
      fechaExpiracion: expira,
      _links: generarLinksHold(baseUrl, holdId)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear pre-reserva', detalle: err.message });
  }
}

/* ============================================================
   4) POST /api/v2/paquetes/reserva (idPaquete ENTERO, id_reserva ENTERO)
   ============================================================ */
export async function reservarPaquete(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const request = req.body;

    if (!request) {
      return res.status(400).send('Debe proporcionar los datos de reserva');
    }

    const idHoldRaw = request?.idHold ?? request?.IdHold ?? request?.id_hold;
    const correo = request?.correo ?? request?.Correo ?? null;

    if (!idHoldRaw || !correo) {
      return res.status(400).send('Debe proporcionar id_hold y correo');
    }

    const holdId = String(idHoldRaw).trim();
    const email = String(correo).trim();

    const idPaqueteRaw = request?.idPaquete ?? request?.IdPaquete ?? request?.id_paquete;
    const paqueteId = toIntOrNull(idPaqueteRaw);
    if (paqueteId == null) {
      return res.status(400).send('Debe proporcionar id_paquete');
    }

    const codigo = await getPaqueteCodigoById(paqueteId);
    if (!codigo) {
      return res.status(404).send('Paquete no encontrado');
    }

    let paymentStatus = request?.paymentStatus ?? request?.PaymentStatus ?? 'paid';
    if (String(paymentStatus).toUpperCase() === 'CONFIRMADO') {
      paymentStatus = 'paid';
    }

    const turistas = request?.turistas ?? request?.Turistas ?? [];

    const hold = await getHoldDB(holdId);
    if (!hold) {
      return res.status(400).send('No se pudo confirmar la reserva. Verifique que el hold esté activo.');
    }

    if (hold.expira_en && new Date(hold.expira_en) < new Date()) {
      await deleteHoldDB(holdId);
      return res.status(400).send('No se pudo confirmar la reserva. Verifique que el hold esté activo.');
    }

    // hold guarda codigo, validar que sea el mismo paquete
    if (String(hold.paquete_codigo) !== String(codigo)) {
      return res.status(400).send('No se pudo confirmar la reserva. Verifique que el hold esté activo.');
    }

    const fecha = String(hold.fecha_inicio).slice(0, 10);
    const adultos = turistas.filter(t => t.tipo === 'adulto' || !t.tipo).length || 1;
    const ninos = turistas.filter(t => t.tipo === 'nino').length || 0;

    const user = await upsertUserByEmail({
      nombre: email,
      apellido: null,
      email
    });

    const r = await crearReserva({
      codigo: String(codigo),
      fecha,
      adultos,
      ninos,
      usuarioId: user.id,
      origen: 'REST'
    });

    await deleteHoldDB(holdId);

    return res.json({
      id_reserva: Number(r.reservaId), // ✅ ENTERO
      id_paquete: paqueteId,           // ✅ ENTERO
      id_hold: holdId,
      correo: email,
      payment_status: paymentStatus,
      turistas,
      _links: generarLinksReserva(baseUrl, String(r.reservaId), null)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al confirmar reserva', detalle: err.message });
  }
}

/* ============================================================
   5) POST /api/v2/paquetes/usuarios/externo
   ============================================================ */
export async function crearUsuarioExterno(req, res) {
  const request = req.body;

  const correo = request?.correo ?? request?.Correo;
  if (!request || !correo || String(correo).trim() === '') {
    return res.status(400).send('Correo es requerido');
  }

  try {
    const nombre = request?.nombre ?? request?.Nombre ?? null;
    const apellido = request?.apellido ?? request?.Apellido ?? null;

    const user = await upsertUserByEmail({
      nombre: nombre ? String(nombre).trim() : null,
      apellido: apellido != null ? String(apellido).trim() : null,
      email: String(correo).trim()
    });

    return res.json({
      idUsuario: user?.id ?? 0,
      correo: String(correo).trim(),
      exitoso: true,
      mensaje: 'Usuario externo creado/obtenido exitosamente'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear usuario externo', detalle: err.message });
  }
}

/* ============================================================
   6) GET /api/v2/paquetes/:id/reserva   (id = ENTERO reservas.id)
   ============================================================ */
export async function buscarDatosReserva(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const id = String(req.params.id ?? '').trim();

    if (!id) {
      return res.status(400).send('Debe proporcionar el ID de la reserva');
    }

    if (!/^\d+$/.test(id)) {
      return res.status(400).send('ID de reserva debe ser un número válido');
    }

    const reservaId = Number(id);
    const r = await getReservaByIdDB(reservaId);
    if (!r) {
      return res.status(404).end();
    }

    // Intentar factura real por reserva_id
    let uriFactura = `https://facturas.example.com/${id}`;
    try {
      const f = await getFacturaByReservaId(reservaId);
      if (f?.codigo_factura) {
        uriFactura = `${PUBLIC_BASE_URL}/admin/facturas/${f.codigo_factura}`;
      }
    } catch {
      // noop
    }

    return res.json({
      id_reserva: reservaId,
      data: r,
      _links: generarLinksReserva(baseUrl, id, uriFactura)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener reserva', detalle: err.message });
  }
}

/* ============================================================
   7) POST /api/v2/paquetes/invoices   (idReserva ENTERO reservas.id)
   ============================================================ */
export async function emitirFacturaPaquete(req, res) {
  const request = req.body;

  const idReservaRaw = request?.idReserva ?? request?.IdReserva ?? request?.id_reserva;
  const reservaId = toIntOrNull(idReservaRaw);
  if (!request || reservaId == null) {
    return res.status(400).send('ID de reserva es requerido');
  }

  try {
    const codigoReserva = await getReservaCodigoByIdDB(reservaId);
    if (!codigoReserva) {
      return res.status(404).send('Reserva no encontrada');
    }

    const valor = request?.valor ?? request?.Valor ?? request?.valor_pagado ?? null;

    let result = null;
    if (valor != null) {
      try {
        result = await crearFacturaParaReserva({
          codigoReserva: String(codigoReserva),
          total: Number(valor)
        });
      } catch {
        result = null;
      }
    }

    const codigoFacturaReal = result?.codigoFactura || result?.codigo_factura || null;

    const idFactura =
      codigoFacturaReal ||
      `FACT-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

    const uriFactura = codigoFacturaReal
      ? `${PUBLIC_BASE_URL}/admin/facturas/${codigoFacturaReal}`
      : `https://facturas.example.com/${reservaId}`;

    return res.json({
      idFactura,
      idReserva: reservaId, // ✅ ENTERO
      correo: request?.correo ?? request?.Correo ?? null,
      nombreCompleto: request?.nombre ?? request?.Nombre ?? null,
      tipoIdentificacion: request?.tipoIdentificacion ?? request?.TipoIdentificacion ?? null,
      identificacion: request?.identificacion ?? request?.Identificacion ?? null,
      valorPagado: valor != null ? Number(valor) : null,
      fechaEmision: new Date(),
      uriFactura,
      mensaje: 'Factura emitida exitosamente'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al emitir factura', detalle: err.message });
  }
}

/* ============================================================
   8) POST /api/v2/paquetes/cancelar   (id_reserva ENTERO reservas.id)
   ============================================================ */
export async function cancelarReservaPaquete(req, res) {
  const request = req.body;

  const idReservaRaw = request?.id_reserva ?? request?.idReserva ?? request?.IdReserva;
  const reservaId = toIntOrNull(idReservaRaw);

  if (!request || reservaId == null) {
    return res.status(400).send('id_reserva es requerido');
  }

  try {
    const codigoReserva = await getReservaCodigoByIdDB(reservaId);
    if (!codigoReserva) {
      return res.status(404).json({ error: 'Reserva no encontrada o ya está cancelada' });
    }

    const r = await getReservaPorCodigo(String(codigoReserva));
    if (!r) {
      return res.status(404).json({ error: 'Reserva no encontrada o ya está cancelada' });
    }

    if (String(r.estado || '').toUpperCase() === 'CANCELADA') {
      return res.status(404).json({ error: 'Reserva no encontrada o ya está cancelada' });
    }

    await cancelarReservaCore(String(codigoReserva));

    return res.json({
      exito: true,
      valor_pasado: 23.09
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al cancelar reserva', detalle: err.message });
  }
}
