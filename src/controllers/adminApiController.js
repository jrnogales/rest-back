// src/controllers/adminApiController.js
import { listarReservasAdminDB, getReservaPorCodigo } from '../models/reservaModel.js';
import { listarFacturasDB, getFacturaPorIdDB, getDetalleFacturaDB } from '../models/facturaModel.js';
import { findUsersByIds, updateUserRolEstado } from '../models/usuarioModel.js';
import { getPaquetesByIds } from '../models/paqueteModel.js';
import { pools } from '../config/db.js';

const poolUsuarios = pools.usuarios;

// GET /api/v1/reservas (admin)
export async function listarReservasAdmin(req, res) {
  try {
    const reservas = await listarReservasAdminDB();

    const userIds = [...new Set(reservas.map(r => r.usuario_id).filter(Boolean))];
    const usuarios = await findUsersByIds(userIds);
    const userMap = new Map(usuarios.map(u => [u.id, u]));

    // paquete_titulo ya viene guardado en reservas (snapshot)
    const rows = reservas.map(r => {
      const u = r.usuario_id ? userMap.get(r.usuario_id) : null;
      return {
        id: r.id,
        codigo_reserva: r.codigo_reserva,
        fecha_viaje: r.fecha_viaje,
        adultos: r.adultos,
        ninos: r.ninos,
        total_usd: r.total_usd,
        estado: r.estado,
        paquete_titulo: r.paquete_titulo || null,
        usuario_nombre: u?.nombre || null,
        usuario_email: u?.email || null,
      };
    });

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] listarReservasAdmin error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// GET /api/v1/facturas (admin)
export async function listarFacturasAdmin(req, res) {
  try {
    const facturas = await listarFacturasDB();

    // Traemos reservas desde DB reservas (sin join)
    const reservaIds = [...new Set(facturas.map(f => f.reserva_id).filter(Boolean))];
    let reservas = [];
    if (reservaIds.length) {
      const { rows } = await pools.reservas.query(
        `SELECT id, codigo_reserva, fecha_viaje, usuario_id, paquete_titulo
           FROM reservas
          WHERE id = ANY($1::int[])`,
        [reservaIds]
      );
      reservas = rows;
    }
    const reservaMap = new Map(reservas.map(r => [r.id, r]));

    const userIds = [...new Set(reservas.map(r => r.usuario_id).filter(Boolean))];
    const usuarios = await findUsersByIds(userIds);
    const userMap = new Map(usuarios.map(u => [u.id, u]));

    const rows = facturas.map(f => {
      const r = f.reserva_id ? reservaMap.get(f.reserva_id) : null;
      const u = r?.usuario_id ? userMap.get(r.usuario_id) : null;

      return {
        id: f.id,
        codigo_factura: f.codigo_factura,
        fecha_emision: f.fecha_emision,
        subtotal: f.subtotal,
        iva: f.iva,
        total: f.total,
        metodo_pago: f.metodo_pago,
        estado: f.estado,
        codigo_reserva: r?.codigo_reserva || null,
        fecha_viaje: r?.fecha_viaje || null,
        paquete_titulo: r?.paquete_titulo || null,
        nombre: u?.nombre || null,
        apellido: u?.apellido || null,
        email: u?.email || null,
      };
    });

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] listarFacturasAdmin error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// GET /api/v1/facturas/:id (admin)
export async function obtenerFacturaPorId(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

    const factura = await getFacturaPorIdDB(id);
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    // composición: reserva + usuario
    let reserva = null;
    if (factura.reserva_id) {
      const { rows } = await pools.reservas.query(
        `SELECT id, codigo_reserva, fecha_viaje, adultos, ninos, usuario_id, paquete_titulo
           FROM reservas WHERE id=$1 LIMIT 1`,
        [factura.reserva_id]
      );
      reserva = rows[0] || null;
    }

    let usuario = null;
    if (reserva?.usuario_id) {
      const { rows } = await poolUsuarios.query(
        `SELECT nombre, apellido, cedula, email
           FROM usuarios WHERE id=$1 LIMIT 1`,
        [reserva.usuario_id]
      );
      usuario = rows[0] || null;
    }

    return res.json({
      ok: true,
      data: {
        id: factura.id,
        codigo_factura: factura.codigo_factura,
        fecha_emision: factura.fecha_emision,
        subtotal: factura.subtotal,
        iva: factura.iva,
        total: factura.total,
        metodo_pago: factura.metodo_pago,
        estado: factura.estado,
        codigo_reserva: reserva?.codigo_reserva || null,
        fecha_viaje: reserva?.fecha_viaje || null,
        adultos: reserva?.adultos || null,
        ninos: reserva?.ninos || null,
        paquete_titulo: reserva?.paquete_titulo || null,
        nombre: usuario?.nombre || null,
        apellido: usuario?.apellido || null,
        cedula: usuario?.cedula || null,
        email: usuario?.email || null,
      }
    });
  } catch (err) {
    console.error('[ADMIN] obtenerFacturaPorId error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// GET /api/v1/facturas/:id/detalle
export async function obtenerDetalleFactura(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

    const rows = await getDetalleFacturaDB(id);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] obtenerDetalleFactura error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// GET /api/v1/usuarios (admin)
export async function listarUsuariosAdmin(req, res) {
  try {
    const { rows } = await poolUsuarios.query(
      `SELECT id, nombre, apellido, email, rol, cedula, telefono, estado
         FROM usuarios
         ORDER BY id`
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] listarUsuariosAdmin error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// PUT /api/v1/usuarios/:id/rol
export async function actualizarUsuarioRolEstado(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

    const { rol, estado } = req.body || {};
    const updated = await updateUserRolEstado(id, rol, estado);

    if (!updated) return res.status(404).json({ ok:false, error:'Usuario no encontrado' });

    return res.json({ ok:true, data: updated });
  } catch (err) {
    console.error('[ADMIN] actualizarUsuarioRolEstado error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
