import express from 'express';
import * as C from '../controllers/integracionController.js';
// 👇 Controlador de pagos externo
import { procesarPago as procesarPagoBanco } from '../controllers/integracionPagosController.js';

const router = express.Router();

// ========== GET ==========
router.get('/paquetes/search',        C.buscarServicios);
router.get('/paquetes/availability',  C.verificarDisponibilidad);
router.get('/paquetes/:id',           C.obtenerDetalleServicio);

// ========== POST ==========
router.post('/paquetes/quote',        C.cotizarReserva);
router.post('/paquetes/hold',         C.crearPreReserva);
router.post('/paquetes/book',         C.confirmarReserva);

// Cancelación estándar sin reembolso (legacy)
router.post('/paquetes/cancel',       C.cancelarReservaIntegracion);

// 🔥 NUEVO — Cancelación con política + reembolso
router.post('/cancelar-con-reembolso', C.cancelarConReembolso);

// ========== DELETE ==========
router.delete('/paquetes/book/:bookingId', C.cancelarReservaIntegracion);

// 🔹 Pago externo correcto
router.post('/pagos', procesarPagoBanco);

export default router;
