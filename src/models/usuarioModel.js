// src/models/usuarioModel.js
import { pool } from '../config/db.js';
import bcrypt from 'bcrypt';

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT * FROM usuarios WHERE email = $1 LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM usuarios WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function createUser({ nombre, apellido, email, telefono, cedula, password }) {
  const hash = await bcrypt.hash(password, 10);

  const { rows } = await pool.query(
    `
    INSERT INTO usuarios(nombre, apellido, email, telefono, cedula, password_hash, rol, estado, creado_en)
    VALUES ($1,$2,$3,$4,$5,$6,'user','activo', NOW())
    RETURNING id, nombre, apellido, email, telefono, cedula, rol, estado
    `,
    [nombre, apellido, email, telefono, cedula, hash]
  );

  return rows[0];
}
