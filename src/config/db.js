import pkg from 'pg';
const { Pool } = pkg;

const useSSL = (process.env.DB_SSL || '').toLowerCase() === 'true';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

export default pool;
