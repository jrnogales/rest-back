// src/models/usuarioModel.js
import { pools } from '../config/db.js';
import bcrypt from 'bcrypt';

const pool = pools.usuarios;

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

// Para admin (batch)
export async function findUsersByIds(ids = []) {
  const clean = ids.map(Number).filter(Boolean);
  if (clean.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, nombre, apellido, email, rol, cedula, telefono, estado
       FROM usuarios
      WHERE id = ANY($1::int[])
    `,
    [clean]
  );
  return rows;
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

// Booking bus: “upsert por email”
export async function upsertUserByEmail({ nombre, apellido = null, email }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT id, email FROM usuarios WHERE email=$1 LIMIT 1`,
      [email]
    );

    let user;
    if (found.rows.length) {
      user = found.rows[0];

      await client.query(
        `UPDATE usuarios
            SET nombre=$1,
                apellido=COALESCE($2, apellido)
          WHERE id=$3`,
        [nombre, apellido, user.id]
      );
    } else {
      // ✅ Defaults para usuarios externos (Booking Bus)
      const telefonoDefault = '0000000000';
      const passwordDefault = `EXTERNAL:${email}`;
      const passwordHash = await bcrypt.hash(passwordDefault, 10);

      const ins = await client.query(
        `
        INSERT INTO usuarios (nombre, apellido, email, telefono, cedula, password_hash, rol, estado, creado_en)
        VALUES ($1,$2,$3,$4,NULL,$5,'user','activo',NOW())
        RETURNING id, email
        `,
        [nombre, apellido, email, telefonoDefault, passwordHash]
      );

      user = ins.rows[0];
    }

    await client.query('COMMIT');
    return user;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// Admin: update rol/estado
export async function updateUserRolEstado(id, rol, estado) {
  const nuevoRol = (rol === 'admin') ? 'admin' : 'user';
  const nuevoEstado = (estado === 'inactivo' || estado === 'Inactivo') ? 'inactivo' : 'activo';

  const { rows } = await pool.query(
    `
    UPDATE usuarios
       SET rol=$1, estado=$2
     WHERE id=$3
     RETURNING id, nombre, apellido, email, rol, cedula, telefono, estado
    `,
    [nuevoRol, nuevoEstado, Number(id)]
  );
  return rows[0] || null;
}
