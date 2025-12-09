// src/routes/adminApiRoutes.js
import express from 'express';
import {
  listarReservasAdmin,
  listarFacturasAdmin,
  obtenerFacturaPorId,
  obtenerDetalleFactura,
  listarUsuariosAdmin,
} from '../controllers/adminApiController.js';

const router = express.Router();

// Reservas (admin)
router.get('/reservas', listarReservasAdmin);

// Facturas (admin)
router.get('/facturas', listarFacturasAdmin);
router.get('/facturas/:id', obtenerFacturaPorId);
router.get('/facturas/:id/detalle', obtenerDetalleFactura);

// Usuarios (admin)
router.get('/usuarios', listarUsuariosAdmin);

export default router;
