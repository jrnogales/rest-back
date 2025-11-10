// src/models/disponibilidadModel.js
import { pool } from '../config/db.js';

/**
 * Asegura que exista la fila de disponibilidad (crea si no existe)
 * y la devuelve. Útil para verificar stock antes de reservar.
 *
 * @param {number} paqueteId
 * @param {string} fecha - 'YYYY-MM-DD'
 * @returns {Promise<{id:number, paquete_id:number, fecha:string, cupos_totales:number, cupos_reservados:number} | null>}
 */
export async function ensureAndGetDisponibilidad(paqueteId, fecha) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crea la fila si no existe (30 cupos por defecto)
    await client.query(
      `
      INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
      VALUES ($1, $2, 30, 0)
      ON CONFLICT (paquete_id, fecha) DO NOTHING
      `,
      [paqueteId, String(fecha)]
    );

    // Lee la disponibilidad actual
    const { rows } = await client.query(
      `
      SELECT id, paquete_id, fecha, cupos_totales, cupos_reservados
        FROM disponibilidad
       WHERE paquete_id = $1 AND fecha = $2
      `,
      [paqueteId, String(fecha)]
    );

    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Solo obtiene la fila (no crea si falta)
 */
export async function getDisponibilidad(paqueteId, fecha) {
  const { rows } = await pool.query(
    `
    SELECT id, paquete_id, fecha, cupos_totales, cupos_reservados
      FROM disponibilidad
     WHERE paquete_id = $1 AND fecha = $2
    `,
    [paqueteId, String(fecha)]
  );
  return rows[0] || null;
}
