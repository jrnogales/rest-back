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

// ✅ URL pública real del backend desplegado en Render
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
// Requiere tabla pre_reservas en DB reservas con columnas:
// id_hold (text, pk), paquete_codigo (text), fecha_inicio (date/text), turistas (jsonb/text), expira_en (timestamp), creado_en (timestamp)
async function createHoldDB({ id_hold, paquete_codigo, fecha_inicio, turistas, expira_en }) {
  await poolReservas.query(
    `
    INSERT INTO pre_reservas (id_hold, paquete_codigo, fecha_inicio, turistas, expira_en, creado_en)
    VALUES ($1,$2,$3,$4,$5,NOW())
    `,
    [id_hold, paquete_codigo, fecha_inicio, JSON.stringify(turistas || []), expira_en]
  );
}

async function getHoldDB(id_hold) {
  const { rows } = await poolReservas.query(
    `SELECT * FROM pre_reservas WHERE id_hold=$1 LIMIT 1`,
    [String(id_hold)]
  );
  return rows[0] || null;
}

async function deleteHoldDB(id_hold) {
  await poolReservas.query(`DELETE FROM pre_reservas WHERE id_hold=$1`, [String(id_hold)]);
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
      body: { idPaquete, fechaInicio, personas }
   ============================================================ */
export async function validarDisponibilidadPaquete(req, res) {
  try {
    const { idPaquete, fechaInicio, personas } = req.body || {};

    const codigo = String(idPaquete || '').trim();
    const fecha = String(fechaInicio || '').slice(0, 10);
    const num = Math.max(0, parseInt(personas || '0', 10));

    if (!codigo || !fecha || !num) {
      return res.status(400).json({ disponible: false, mensaje: 'Datos incompletos' });
    }

    // Verificamos que exista en DB paquetes
    const pRes = await poolPaquetes.query(
      `SELECT codigo FROM paquetes WHERE codigo=$1 LIMIT 1`,
      [codigo]
    );
    if (!pRes.rows.length) {
      return res.status(404).json({ disponible: false, mensaje: 'Paquete no encontrado' });
    }

    // Disponibilidad en DB reservas por paquete_codigo + fecha
    const disp = await ensureAndGetDisponibilidad(codigo, fecha);

    const libres = Number(disp.cupos_totales) - Number(disp.cupos_reservados);
    const disponible = libres >= num;

    return res.json({ disponible, cupos_disponibles: libres });
  } catch (err) {
    console.error('validarDisponibilidadPaquete:', err);
    return res.status(500).json({ disponible: false, mensaje: 'Error interno' });
  }
}

/* ============================================================
   3) POST /api/v2/paquetes/pre-reserva
      body: { id_paquete, fecha_inicio, turistas[], duracionHoldSegundos? }
   ============================================================ */
export async function crearPreReservaPaquete(req, res) {
  try {
    const { id_paquete, fecha_inicio, turistas = [], duracionHoldSegundos } = req.body || {};

    const codigo = String(id_paquete || '').trim();
    const fecha = String(fecha_inicio || '').slice(0, 10);

    if (!codigo || !fecha) return res.status(400).json({ error: 'Datos incompletos' });

    // existe en paquetes
    const pRes = await poolPaquetes.query(`SELECT codigo FROM paquetes WHERE codigo=$1 LIMIT 1`, [codigo]);
    if (!pRes.rows.length) return res.status(404).json({ error: 'Paquete no encontrado' });

    const holdId = 'HOLD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const seg = Math.max(60, parseInt(duracionHoldSegundos || '600', 10));
    const expiraEn = new Date(Date.now() + seg * 1000).toISOString();

    // guardamos en DB reservas
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
      body: { id_paquete, id_hold, correo, turistas[] }
   ============================================================ */
export async function reservarPaquete(req, res) {
  try {
    const { id_paquete, id_hold, correo, turistas = [] } = req.body || {};

    const codigo = String(id_paquete || '').trim();
    const holdId = String(id_hold || '').trim();
    const email = String(correo || '').trim();

    if (!codigo || !holdId || !email) return res.status(400).json({ error: 'Datos incompletos' });

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

    // 1) upsert usuario en DB usuarios
    const user = await upsertUserByEmail({
      nombre: email,
      apellido: null,
      email
    });

    // 2) crear reserva en DB reservas (usa snapshot de paquete desde DB paquetes internamente)
    const r = await crearReserva({
      codigo,
      fecha,
      adultos,
      ninos,
      usuarioId: user.id,
      origen: 'REST'
    });

    // 3) limpiar hold
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
      body: { bookingUserId?, nombre, apellido?, correo }
   ============================================================ */
export async function crearUsuarioExterno(req, res) {
  try {
    const { nombre, apellido, correo } = req.body || {};
    const email = String(correo || '').trim();
    const first = String(nombre || '').trim();
    const last = apellido != null ? String(apellido).trim() : null;

    if (!email || !first) return res.status(400).json({ error: 'correo y nombre son obligatorios' });

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
      body: { id_reserva, correo, nombre, valor_pagado, id_transaccion, ... }
   ============================================================ */
export async function emitirFacturaPaquete(req, res) {
  try {
    const { id_reserva, correo, nombre, valor_pagado } = req.body || {};

    if (!id_reserva || !correo || !nombre || !valor_pagado) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Creamos factura en DB facturas, leyendo reserva desde DB reservas
    const result = await crearFacturaParaReserva({
      codigoReserva: String(id_reserva),
      total: Number(valor_pagado)
    });

    // ✅ Link de factura usando TU backend real
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
    const idReserva = String(req.params.id || '').trim();
    if (!idReserva) return res.status(400).json({ error: 'id de reserva requerido' });

    const r = await getReservaPorCodigo(idReserva);
    if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });

    const f = await getFacturaByReservaId(r.id);

    const uri_factura = f
      ? `${PUBLIC_BASE_URL}/admin/facturas/${f.codigo_factura}`
      : null;

    return res.json({
      id_paquete: r.paquete_codigo,
      correo: null, // opcional
      fecha_inicio: r.fecha_viaje,
      duracion: 1,
      tipo_actividad: 'Paquete turístico',
      turistas: {
        adultos: r.adultos,
        ninos: r.ninos
      },
      valor_pagado: r.total_usd,
      uri_factura
    });
  } catch (err) {
    console.error('buscarDatosReserva:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

/* ============================================================
   8) POST /api/v2/paquetes/cancelar
      body: { id_reserva }
   ============================================================ */
export async function cancelarReservaPaquete(req, res) {
  try {
    const { id_reserva } = req.body || {};
    const codigo = String(id_reserva || '').trim();

    if (!codigo) {
      return res.status(400).json({ exito: false, mensaje: 'id_reserva es obligatorio' });
    }

    const r = await getReservaPorCodigo(codigo);
    if (!r) return res.status(404).json({ exito: false, mensaje: 'Reserva no encontrada' });

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
      valor_pagado: Number(r.total_usd || 0),
    });
  } catch (err) {
    console.error('cancelarReservaPaquete:', err);
    return res.status(500).json({ exito: false, mensaje: 'Error interno al cancelar' });
  }
}
