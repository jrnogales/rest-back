// src/models/disponibilidadModel.js
import { pools } from '../config/db.js';
const pool = pools.reservas;

/**
 * En DB separada, disponibilidad NO debe depender de paquete_id (porque paquetes está en otra DB).
 * Usaremos paquete_codigo (string).
 */
export async function ensureAndGetDisponibilidad(paqueteCodigo, fecha) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `
      INSERT INTO disponibilidad (paquete_codigo, fecha, cupos_totales, cupos_reservados)
      VALUES ($1, $2, 30, 0)
      ON CONFLICT (paquete_codigo, fecha) DO NOTHING
      `,
      [String(paqueteCodigo), String(fecha)]
    );

    const { rows } = await client.query(
      `
      SELECT id, paquete_codigo, fecha, cupos_totales, cupos_reservados
        FROM disponibilidad
       WHERE paquete_codigo = $1 AND fecha = $2
      `,
      [String(paqueteCodigo), String(fecha)]
    );

    await client.query('COMMIT');
    return rows[0] || null;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function getDisponibilidad(paqueteCodigo, fecha) {
  const { rows } = await pool.query(
    `
    SELECT id, paquete_codigo, fecha, cupos_totales, cupos_reservados
      FROM disponibilidad
     WHERE paquete_codigo = $1 AND fecha = $2
    `,
    [String(paqueteCodigo), String(fecha)]
  );
  return rows[0] || null;
}
