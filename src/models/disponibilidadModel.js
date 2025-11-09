import { pool } from '../config/db.js';

export async function ensureAndGetDisponibilidad(paqueteId, fecha) {
  await pool.query(
    INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
     VALUES (,,30,0)
     ON CONFLICT (paquete_id, fecha) DO NOTHING,
    [paqueteId, fecha]
  );
  const { rows } = await pool.query(
    SELECT id, cupos_totales, cupos_reservados
       FROM disponibilidad
      WHERE paquete_id= AND fecha=,
    [paqueteId, fecha]
  );
  return rows[0] || null;
}
