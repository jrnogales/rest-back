// src/controllers/adminPaquetesController.js
import { pool } from '../config/db.js';

/**
 * POST /api/v1/paquetes
 * Crea un nuevo paquete
 */
export async function crearPaquete(req, res) {
  try {
    const {
      codigo,
      titulo,
      descripcion = '',
      imagen = '',
      precio_adulto,
      precio_nino
    } = req.body || {};

    if (!codigo || !titulo) {
      return res.status(400).json({
        ok: false,
        error: 'codigo y titulo son requeridos'
      });
    }

    // nunca negativos
    const precioAdulto = Math.max(0, Number(precio_adulto || 0));
    const precioNino   = Math.max(0, Number(precio_nino   || 0));

    const { rows } = await pool.query(
      `
      INSERT INTO paquetes
        (codigo, titulo, descripcion, imagen,
         precio_adulto, precio_nino, stock)
      VALUES ($1,$2,$3,$4,$5,$6,30)
      RETURNING id, codigo, titulo, descripcion, imagen,
                precio_adulto, precio_nino
      `,
      [codigo, titulo, descripcion, imagen, precioAdulto, precioNino]
    );

    return res.status(201).json({
      ok: true,
      data: rows[0]
    });
  } catch (err) {
    console.error('[crearPaquete] error:', err);
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}

/**
 * PUT /api/v1/paquetes/:id
 * Actualiza un paquete existente
 */
export async function actualizarPaquete(req, res) {
  try {
    const { id } = req.params;
    const {
      codigo,
      titulo,
      descripcion = '',
      imagen = '',
      precio_adulto,
      precio_nino
    } = req.body || {};

    if (!id) {
      return res.status(400).json({ ok: false, error: 'id requerido' });
    }
    if (!codigo || !titulo) {
      return res.status(400).json({
        ok: false,
        error: 'codigo y titulo son requeridos'
      });
    }

    const precioAdulto = Math.max(0, Number(precio_adulto || 0));
    const precioNino   = Math.max(0, Number(precio_nino   || 0));

    const { rowCount, rows } = await pool.query(
      `
      UPDATE paquetes
         SET codigo        = $1,
             titulo        = $2,
             descripcion   = $3,
             imagen        = $4,
             precio_adulto = $5,
             precio_nino   = $6
       WHERE id = $7
       RETURNING id, codigo, titulo, descripcion, imagen,
                 precio_adulto, precio_nino
      `,
      [codigo, titulo, descripcion, imagen, precioAdulto, precioNino, id]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Paquete no encontrado'
      });
    }

    return res.json({
      ok: true,
      data: rows[0]
    });
  } catch (err) {
    console.error('[actualizarPaquete] error:', err);
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}

/**
 * DELETE /api/v1/paquetes/:id
 * Elimina un paquete (y tablas relacionadas básicas)
 */
export async function eliminarPaquete(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ ok: false, error: 'id requerido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Igual que en tu código SOAP: limpiar dependencias básicas
    await client.query(
      'DELETE FROM disponibilidad WHERE paquete_id = $1',
      [id]
    );
    await client.query(
      'DELETE FROM carrito WHERE paquete_id = $1',
      [id]
    );

    const { rowCount } = await client.query(
      'DELETE FROM paquetes WHERE id = $1',
      [id]
    );

    await client.query('COMMIT');

    if (rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Paquete no encontrado'
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[eliminarPaquete] error:', err);
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  } finally {
    client.release();
  }
}
