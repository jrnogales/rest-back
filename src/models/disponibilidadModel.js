// src/models/disponibilidadModel.js
import { pool } from '../config/db.js';

/**
 * Crea la fila de disponibilidad si no existe (cupos_totales por defecto = 30).
 */
export async function ensureDisponibilidad(paqueteId, fecha, cuposTotales = 30) {
  const sql = `
    INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
    VALUES ($1, $2, $3, 0)
    ON CONFLICT (paquete_id, fecha) DO NOTHING
  `;
  await pool.query(sql, [paqueteId, fecha, cuposTotales]);
}

/**
 * Obtiene la disponibilidad; si forUpdate=true, bloquea la fila.
 */
export async function getDisponibilidad(paqueteId, fecha, forUpdate = false) {
  let sql = `
    SELECT id, cupos_totales, cupos_reservados
    FROM disponibilidad
    WHERE paquete_id = $1 AND fecha = $2
  `;
  if (forUpdate) sql += ' FOR UPDATE';

  const { rows } = await pool.query(sql, [paqueteId, fecha]);
  return rows;
}

/**
 * Incrementa la cantidad de cupos reservados.
 */
export async function reservarCupos(paqueteId, fecha, cantidad) {
  const sql = `
    UPDATE disponibilidad
       SET cupos_reservados = cupos_reservados + $1
     WHERE paquete_id = $2 AND fecha = $3
  `;
  await pool.query(sql, [cantidad, paqueteId, fecha]);
}
