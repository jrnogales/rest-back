// src/config/db.js
import pkg from 'pg';
const { Pool } = pkg;

// Fuerza SSL con no-verify para cert self-signed
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }   // <-- clave
});

export default pool;
