import express from 'express';
import cors from 'cors';
import pino from 'pino';
import pinoHttp from 'pino-http';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';

import integracionRoutes from './routes/integracionRoutes.js';

dotenv.config();

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

app.use(pinoHttp({ logger }));
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => res.json({ ok:true, ts: Date.now() }));

const ymlPath = path.join(process.cwd(), 'src', 'openapi.yaml');
const swaggerDoc = YAML.parse(fs.readFileSync(ymlPath, 'utf8'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
app.get('/docs/openapi.json', (req, res) => res.json(swaggerDoc));

app.use('/api/integracion', integracionRoutes);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  logger.info(REST Integración escuchando en http://localhost:);
  logger.info(Docs: http://localhost:/docs);
});
