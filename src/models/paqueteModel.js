// src/models/paqueteModel.js
import { pool } from '../config/db.js';

// 🔹 Lista pública de paquetes (solo activos)
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
    WHERE estado = 'activo'        -- 👈 solo se muestran los activos
    ORDER BY id
  `);
  return rows;
}

// 🔹 Un paquete por código (para detalle, etc.)
export async function getPaqueteByCodigo(codigo) {
  const { rows } = await pool.query(
    `
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
    WHERE codigo = $1
    LIMIT 1
    `,
    [codigo]
  );
  return rows[0] || null;
}
