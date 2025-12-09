// src/controllers/adminApiController.js
import { pool } from '../config/db.js';

/**
 * GET /api/v1/reservas
 * Lista TODAS las reservas (para el panel admin)
 */
export async function listarReservasAdmin(req, res) {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        r.id,
        r.codigo_reserva,
        r.fecha_viaje,
        r.adultos,
        r.ninos,
        r.total_usd,
        COALESCE(r.estado, 'CONFIRMADA') AS estado,
        p.titulo       AS paquete_titulo,
        u.nombre       AS usuario_nombre,
        u.email        AS usuario_email
      FROM reservas r
      JOIN paquetes p ON p.id = r.paquete_id
      LEFT JOIN usuarios u ON u.id = r.usuario_id
      ORDER BY r.fecha_viaje DESC, r.id DESC
      `
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] listarReservasAdmin error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/v1/facturas
 * Lista todas las facturas (para el listado admin)
 */
export async function listarFacturasAdmin(req, res) {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        f.id,
        f.codigo_factura,
        f.fecha_emision,
        f.subtotal,
        f.iva,
        f.total,
        f.metodo_pago,
        f.estado,
        r.codigo_reserva,
        r.fecha_viaje,
        p.titulo    AS paquete_titulo,
        u.nombre,
        u.apellido,
        u.email
      FROM facturas f
      LEFT JOIN reservas r ON r.id = f.reserva_id
      LEFT JOIN paquetes p ON p.id = r.paquete_id
      LEFT JOIN usuarios u ON u.id = r.usuario_id
      ORDER BY f.fecha_emision DESC, f.id DESC
      `
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] listarFacturasAdmin error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/v1/facturas/:id
 * Detalle principal de una factura (cabecera)
 */
export async function obtenerFacturaPorId(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: 'id inválido' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        f.id,
        f.codigo_factura,
        f.fecha_emision,
        f.subtotal,
        f.iva,
        f.total,
        f.metodo_pago,
        f.estado,
        r.codigo_reserva,
        r.fecha_viaje,
        r.adultos,
        r.ninos,
        p.titulo     AS paquete_titulo,
        u.nombre,
        u.apellido,
        u.cedula,
        u.email
      FROM facturas f
      LEFT JOIN reservas r ON r.id = f.reserva_id
      LEFT JOIN paquetes p ON p.id = r.paquete_id
      LEFT JOIN usuarios u ON u.id = r.usuario_id
      WHERE f.id = $1
      LIMIT 1
      `,
      [id]
    );

    const factura = rows[0] || null;
    if (!factura) {
      return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    }

    return res.json({ ok: true, data: factura });
  } catch (err) {
    console.error('[ADMIN] obtenerFacturaPorId error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/v1/facturas/:id/detalle
 * Líneas de detalle de una factura
 */
export async function obtenerDetalleFactura(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: 'id inválido' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id,
        descripcion,
        cantidad,
        precio_unitario,
        total_linea
      FROM detalle_factura
      WHERE factura_id = $1
      ORDER BY id
      `,
      [id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] obtenerDetalleFactura error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/v1/usuarios
 * Lista de usuarios para el panel admin
 */
export async function listarUsuariosAdmin(req, res) {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        nombre,
        apellido,
        email,
        rol,
        cedula,
        telefono,
        estado
      FROM usuarios
      ORDER BY id
      `
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] listarUsuariosAdmin error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
