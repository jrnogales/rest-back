// src/config/db.js
import pkg from 'pg';
const { Pool } = pkg;

const sslEnabled = String(process.env.DB_SSL || 'true') !== 'false';
const ssl = sslEnabled ? { rejectUnauthorized: false } : undefined;

function makePool(connectionString, name) {
  if (!connectionString) {
    throw new Error(`Falta variable de entorno para ${name}`);
  }
  return new Pool({ connectionString, ssl });
}

export const pools = {
  pagos: makePool(process.env.DATABASE_URL_PAGOS, 'DATABASE_URL_PAGOS'),
  facturas: makePool(process.env.DATABASE_URL_FACTURAS, 'DATABASE_URL_FACTURAS'),
  carrito: makePool(process.env.DATABASE_URL_CARRITO, 'DATABASE_URL_CARRITO'),
  reservas: makePool(process.env.DATABASE_URL_RESERVAS, 'DATABASE_URL_RESERVAS'),
  paquetes: makePool(process.env.DATABASE_URL_PAQUETES, 'DATABASE_URL_PAQUETES'),
  usuarios: makePool(process.env.DATABASE_URL_USUARIOS, 'DATABASE_URL_USUARIOS'),
};

// ✅ ALIAS por compatibilidad (si un archivo viejo sigue usando { pool })
export const pool = pools.reservas;

// helper por compatibilidad (si alguna vez necesitas cerrar todo)
export async function closeAllPools() {
  await Promise.all(Object.values(pools).map(p => p.end().catch(() => {})));
}
