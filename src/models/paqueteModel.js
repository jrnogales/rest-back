import { pool } from '../config/db.js';

// 🔹 Lista pública de paquetes (solo activos)
//    Si estado es NULL lo tratamos como 'activo' por compatibilidad
export async function listPaquetes() {
  const { rows } = await pool.query(`
    SELECT
      id,
      codigo,
      titulo,
      descripcion,
      imagen,
      precio_adulto,
      precio_nino,
      estado
    FROM paquetes
    WHERE COALESCE(estado, 'activo') = 'activo'
    ORDER BY id
  `);
  return rows;
}

// 🔹 Un paquete por código (para detalle, etc.)
export async function listPaquetes() {
  const { rows } = await pool.query(`
    SELECT
      id,
      codigo,
      titulo,
      descripcion,
      imagen,
      precio_adulto,
      precio_nino,
      estado
    FROM paquetes
    WHERE COALESCE(estado, 'activo') = 'activo'
    ORDER BY id
  `);
  return rows;
}
