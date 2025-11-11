import express from 'express';
import cors from 'cors';
import integracionRouter from './routes/integracionRoutes.js'; // default import correcto
// import { logger } from './config/logger.js'; // opcional

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/integracion', integracionRouter);

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'rest-integracion-backend' });
});

app.listen(PORT, HOST, () => {
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`REST Integración escuchando en ${base}`);
});
