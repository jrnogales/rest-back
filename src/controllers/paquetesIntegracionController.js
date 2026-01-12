// src/controllers/paquetesIntegracionController.js
import { pools } from '../config/db.js';
import { ensureAndGetDisponibilidad } from '../models/disponibilidadModel.js';
import {
  crearReserva,
  getReservaPorCodigo,
  cancelarReserva as cancelarReservaCore
} from '../models/reservaModel.js';
import { upsertUserByEmail } from '../models/usuarioModel.js';
import { crearFacturaParaReserva, getFacturaByReservaId } from '../models/facturaModel.js';

const poolPaquetes = pools.paquetes;
const poolReservas = pools.reservas;

// URL pública real del backend desplegado en Render
const PUBLIC_BASE_URL = 'https://rest-back-xnjm.onrender.com';

// ================== Utils ==================
function brief(txt = '', len = 140) {
  const s = String(txt).replace(/\s+/g, ' ').trim();
  return s.length <= len ? s : s.slice(0, len - 1) + '…';
}

function buildPaqueteRow(p) {
  return {
    id_paquete: p.codigo,
    ciudad: 'Cuenca',
    pais: 'Ecuador',
    tipo_actividad: 'Paquete turístico',
    capacidad: Number(p.stock || 30),
    precio_normal: Number(p.precio_adulto || 0),
    precio_actual: Number(p.precio_adulto || 0),
    uri_imagen: p.imagen || '',
    descripcion: brief(p.descripcion || ''),
    duracion: Number(p.duracion_dias || 1),
    currency: p.currency || 'USD'
  };
}

// ================== Pre-reservas (DB) ==================
async function createHoldDB({ id_hold, paquete_codigo, fecha_inicio, turistas, expira_en }) {
  await poolReservas.query(
    `
    INSERT INTO pre_reservas (
      pre_booking_id,
      origen,
      estado,
      expira_en,
      creado_en,

      id_hold,
      paquete_codigo,
      fecha_inicio,
      turistas
    )
    VALUES ($1,'BUS','HOLD',$2,NOW(),$3,$4,$5,$6::jsonb)
    `,
    [
      String(id_hold),                 // pre_booking_id (NOT NULL) ✅
      expira_en,                       // expira_en
      String(id_hold),                 // id_hold
      String(paquete_codigo),          // paquete_codigo
      String(fecha_inicio),            // fecha_inicio
      JSON.stringify(turistas || [])   // turistas
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
   1) GET /api/v2/paquetes
   ============================================================ */
export async function buscarPaquetes(req, res) {
  try {
    const { precio_min, precio_max } = req.query;

    const { rows } = await poolPaquetes.query(`SELECT * FROM paquetes ORDER BY id ASC`);
    let lista = rows.map(buildPaqueteRow);

    const minP = precio_min != null ? Number(precio_min) : null;
    const maxP = precio_max != null ? Number(precio_max) : null;

    if (minP != null) lista = lista.filter(p => p.precio_actual >= minP);
    if (maxP != null) lista = lista.filter(p => p.precio_actual <= maxP);

    return res.json(lista);
  } catch (err) {
    console.error('buscarPaquetes:', err);
    return res.status(500).json({ error: 'Error al buscar paquetes' });
  }
}

/* ============================================================
   2) POST /api/v2/paquetes/availability
   ============================================================ */
export async function validarDisponibilidadPaquete(req, res) {
  try {
    const { idPaquete, fechaInicio, personas } = req.body || {};

    const codigo = String(idPaquete ?? '').trim();
    const fecha = String(fechaInicio ?? '').slice(0, 10);
    const num = Math.max(0, parseInt(personas || '0', 10));

    if (!codigo || !fecha || !num) {
      return res.status(400).json({ disponible: false, mensaje: 'Datos incompletos' });
    }

    const pRes = await poolPaquetes.query(
      `SELECT codigo FROM paquetes WHERE codigo=$1 LIMIT 1`,
      [codigo]
    );
    if (!pRes.rows.length) {
      return res.status(404).json({ disponible: false, mensaje: 'Paquete no encontrado' });
    }

    const disp = await ensureAndGetDisponibilidad(codigo, fecha);
    const libres = Number(disp.cupos_totales) - Number(disp.cupos_reservados);

    return res.json({
      disponible: libres >= num,
      cupos_disponibles: libres
    });
  } catch (err) {
    console.error('validarDisponibilidadPaquete:', err);
    return res.status(500).json({ disponible: false, mensaje: 'Error interno' });
  }
}

/* ============================================================
   3) POST /api/v2/paquetes/pre-reserva
   ============================================================ */
export async function crearPreReservaPaquete(req, res) {
  try {
    const {
      idPaquete,
      id_paquete,
      fechaInicio,
      fecha_inicio,
      turistas = [],
      duracionHoldSegundos
    } = req.body || {};

    const codigo = String(idPaquete ?? id_paquete ?? '').trim();
    const fecha = String(fechaInicio ?? fecha_inicio ?? '').slice(0, 10);

    if (!codigo || !fecha) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const pRes = await poolPaquetes.query(
      `SELECT codigo FROM paquetes WHERE codigo=$1 LIMIT 1`,
      [codigo]
    );
    if (!pRes.rows.length) {
      return res.status(404).json({ error: 'Paquete no encontrado' });
    }

    const holdId = 'HOLD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const seg = Math.max(60, parseInt(duracionHoldSegundos || '600', 10));
    const expiraEn = new Date(Date.now() + seg * 1000).toISOString();

    await createHoldDB({
      id_hold: holdId,
      paquete_codigo: codigo,
      fecha_inicio: fecha,
      turistas,
      expira_en: expiraEn
    });

    return res.json({ id_hold: holdId, expiraEn });
  } catch (err) {
    console.error('crearPreReservaPaquete:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

/* ============================================================
   4) POST /api/v2/paquetes/reserva
   ============================================================ */
export async function reservarPaquete(req, res) {
  try {
    const {
      idPaquete,
      id_paquete,
      idHold,
      id_hold,
      correo,
      turistas = []
    } = req.body || {};

    const codigo = String(idPaquete ?? id_paquete ?? '').trim();
    const holdId = String(idHold ?? id_hold ?? '').trim();
    const email = String(correo ?? '').trim();

    if (!codigo || !holdId || !email) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const hold = await getHoldDB(holdId);
    if (!hold || String(hold.paquete_codigo) !== codigo) {
      return res.status(400).json({ error: 'Hold inválido' });
    }

    if (hold.expira_en && new Date(hold.expira_en) < new Date()) {
      await deleteHoldDB(holdId);
      return res.status(400).json({ error: 'Hold expirado' });
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
      codigo,
      fecha,
      adultos,
      ninos,
      usuarioId: user.id,
      origen: 'REST'
    });

    await deleteHoldDB(holdId);

    return res.json({
      id_reserva: r.codigoReserva,
      reserva_id_interno: r.reservaId
    });
  } catch (err) {
    console.error('reservarPaquete:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

/* ============================================================
   5) POST /api/v2/paquetes/usuarios/externo
   ============================================================ */
export async function crearUsuarioExterno(req, res) {
  try {
    const { nombre, apellido, correo } = req.body || {};

    const email = String(correo ?? '').trim();
    const first = String(nombre ?? '').trim();
    const last = apellido != null ? String(apellido).trim() : null;

    if (!email || !first) {
      return res.status(400).json({ error: 'correo y nombre son obligatorios' });
    }

    const user = await upsertUserByEmail({ nombre: first, apellido: last, email });

    return res.json({
      id_usuario: user.id,
      correo: user.email
    });
  } catch (err) {
    console.error('crearUsuarioExterno:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

/* ============================================================
   6) POST /api/v2/paquetes/invoices
   ============================================================ */
export async function emitirFacturaPaquete(req, res) {
  try {
    const {
      idReserva,
      id_reserva,
      correo,
      nombre,
      valor,
      valor_pagado
    } = req.body || {};

    const codigoReserva = String(idReserva ?? id_reserva ?? '').trim();
    const total = Number(valor ?? valor_pagado);

    if (!codigoReserva || !correo || !nombre || !total) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const result = await crearFacturaParaReserva({
      codigoReserva,
      total
    });

    const uri_factura = `${PUBLIC_BASE_URL}/admin/facturas/${result.codigoFactura}`;

    return res.json({ url_factura: uri_factura });
  } catch (err) {
    console.error('emitirFacturaPaquete:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

/* ============================================================
   7) GET /api/v2/paquetes/:id/reserva
   ============================================================ */
export async function buscarDatosReserva(req, res) {
  try {
    const idReserva = String(req.params.id ?? '').trim();
    if (!idReserva) {
      return res.status(400).json({ error: 'id de reserva requerido' });
    }

    const r = await getReservaPorCodigo(idReserva);
    if (!r) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const f = await getFacturaByReservaId(r.id);

    const uri_factura = f
      ? `${PUBLIC_BASE_URL}/admin/facturas/${f.codigo_factura}`
      : null;

    return res.json({
      idPaquete: r.paquete_codigo,
      fechaInicio: r.fecha_viaje,
      turistas: {
        adultos: r.adultos,
        ninos: r.ninos
      },
      valor: r.total_usd,
      uri_factura
    });
  } catch (err) {
    console.error('buscarDatosReserva:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

/* ============================================================
   8) POST /api/v2/paquetes/cancelar
   ============================================================ */
export async function cancelarReservaPaquete(req, res) {
  try {
    const { idReserva, id_reserva } = req.body || {};
    const codigo = String(idReserva ?? id_reserva ?? '').trim();

    if (!codigo) {
      return res.status(400).json({ exito: false, mensaje: 'id_reserva es obligatorio' });
    }

    const r = await getReservaPorCodigo(codigo);
    if (!r) {
      return res.status(404).json({ exito: false, mensaje: 'Reserva no encontrada' });
    }

    if (String(r.estado || '').toUpperCase() === 'CANCELADA') {
      return res.json({
        exito: false,
        valor_pagado: Number(r.total_usd || 0),
        mensaje: 'La reserva ya estaba cancelada'
      });
    }

    await cancelarReservaCore(codigo);

    return res.json({
      exito: true,
      valor_pagado: Number(r.total_usd || 0)
    });
  } catch (err) {
    console.error('cancelarReservaPaquete:', err);
    return res.status(500).json({ exito: false, mensaje: 'Error interno al cancelar' });
  }
}
