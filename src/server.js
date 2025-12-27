// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import integracionRouter from './routes/integracionRoutes.js';
import paquetesIntegracionRoutes from './routes/paquetesIntegracionRoutes.js';
import adminPaquetesRoutes from './routes/adminPaquetesRoutes.js';
import adminApiRoutes from './routes/adminApiRoutes.js';
import authRoutes from './routes/authRoutes.js';
import reservasRoutes from './routes/reservasRoutes.js';

import { pools } from './config/db.js';

// ⚠️ Temporal (si tu banco o DB usan self-signed)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_VERSION = 'v1';

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// v1 integracion
app.use(`/api/${API_VERSION}/integracion`, integracionRouter);

// auth
app.use(`/api/${API_VERSION}/auth`, authRoutes);

// reservas por usuario
app.use(`/api/${API_VERSION}/reservas`, reservasRoutes);

// booking bus v2
app.use('/api/v2/paquetes', paquetesIntegracionRoutes);

// admin api
app.use(`/api/${API_VERSION}`, adminApiRoutes);

// admin paquetes
app.use(`/api/${API_VERSION}/paquetes`, adminPaquetesRoutes);

// compatibilidad
app.use('/api/integracion', (req, res) => {
  const nuevaRuta = `/api/${API_VERSION}/integracion${req.url}`;
  return res.redirect(308, nuevaRuta);
});

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'rest-integracion-backend', version: API_VERSION });
});

// Debug: prueba cada DB
app.get('/__debug/db', async (_req, res) => {
  try {
    const results = {};
    for (const [name, pool] of Object.entries(pools)) {
      const r = await pool.query('SELECT 1 as ok');
      results[name] = r.rows[0].ok;
    }
    res.json({ ok: true, dbs: results });
  } catch (e) {
    console.error('[DB PING ERROR]', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`Backend escuchando en ${base}`);
});
