// src/models/paqueteModel.js
import { pools } from '../config/db.js';
const pool = pools.paquetes;

export async function listPaquetes() {
  const { rows } = await pool.query(`
    SELECT id, codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, estado,
           COALESCE(stock, 30) AS stock
    FROM paquetes
    WHERE COALESCE(estado, 'activo') = 'activo'
    ORDER BY id
  `);
  return rows;
}

export async function listPaquetesAdmin() {
  const { rows } = await pool.query(`
    SELECT id, codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, estado,
           COALESCE(stock, 30) AS stock
    FROM paquetes
    ORDER BY id
  `);
  return rows;
}

export async function getPaqueteByCodigo(codigo) {
  const { rows } = await pool.query(
    `
    SELECT id, codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, estado,
           COALESCE(stock, 30) AS stock
    FROM paquetes
    WHERE codigo = $1
    LIMIT 1
    `,
    [codigo]
  );
  return rows[0] || null;
}

export async function getPaquetesByIds(ids = []) {
  const clean = ids.map(Number).filter(Boolean);
  if (clean.length === 0) return [];
  const { rows } = await pool.query(
    `
    SELECT id, codigo, titulo, imagen
      FROM paquetes
     WHERE id = ANY($1::int[])
    `,
    [clean]
  );
  return rows;
}

// Admin CRUD
export async function crearPaqueteDB({ codigo, titulo, descripcion, imagen, precioAdulto, precioNino }) {
  const { rows } = await pool.query(
    `
    INSERT INTO paquetes
      (codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, stock, estado)
    VALUES ($1,$2,$3,$4,$5,$6,30,'activo')
    RETURNING id, codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, estado
    `,
    [codigo, titulo, descripcion, imagen, precioAdulto, precioNino]
  );
  return rows[0];
}

export async function actualizarPaqueteDB(id, { codigo, titulo, descripcion, imagen, precioAdulto, precioNino }) {
  const { rows } = await pool.query(
    `
    UPDATE paquetes
       SET codigo=$1, titulo=$2, descripcion=$3, imagen=$4, precio_adulto=$5, precio_nino=$6
     WHERE id=$7
     RETURNING id, codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, estado
    `,
    [codigo, titulo, descripcion, imagen, precioAdulto, precioNino, Number(id)]
  );
  return rows[0] || null;
}

export async function toggleEstadoPaqueteDB(id) {
  const { rows } = await pool.query(
    `
    UPDATE paquetes
       SET estado = CASE WHEN estado='activo' THEN 'inactivo' ELSE 'activo' END
     WHERE id=$1
     RETURNING estado
    `,
    [Number(id)]
  );
  return rows[0] || null;
}

export async function eliminarPaqueteDB(id) {
  const { rowCount } = await pool.query(`DELETE FROM paquetes WHERE id=$1`, [Number(id)]);
  return rowCount > 0;
}
