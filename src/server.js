import express from 'express';
import cors from 'cors';
import integracionRouter from './routes/integracionRoutes.js';
import { pool } from './config/db.js'; // default import correcto
// import { logger } from './config/logger.js'; // opcional
// ⚠️ Temporal y sólo para desbloquear certificados self-signed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/integracion', integracionRouter);

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'rest-integracion-backend' });
});

app.get('/__debug/db', async (_req, res) => {
  try {
    const r = await pool.query('SELECT 1 as ok');
    res.json({ ok: true, db: r.rows[0] });
  } catch (e) {
    console.error('[DB PING ERROR]', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.listen(PORT, HOST, () => {
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`REST Integración escuchando en ${base}`);
});
