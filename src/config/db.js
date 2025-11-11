// src/config/db.js
import pkg from 'pg';
const { Pool } = pkg;

// Por defecto usa SSL (render/neon/heroku lo requieren)
const sslMode = (process.env.DB_SSL || 'true').toLowerCase();

const ssl =
  sslMode === 'false' || sslMode === 'off'
    ? false
    : { rejectUnauthorized: false };

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl
});

export default pool;
