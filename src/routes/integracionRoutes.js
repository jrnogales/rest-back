import express from 'express';
import * as C from '../controllers/integracionController.js';
// 👇 NUEVO: importas el controlador específico de pagos
import { procesarPago as procesarPagoBanco } from '../controllers/integracionPagosController.js';

const router = express.Router();

// GET
router.get('/paquetes/search',        C.buscarServicios);
router.get('/paquetes/availability',  C.verificarDisponibilidad);
router.get('/paquetes/:id',           C.obtenerDetalleServicio);

// POST
router.post('/paquetes/quote',        C.cotizarReserva);
router.post('/paquetes/hold',         C.crearPreReserva);
router.post('/paquetes/book',         C.confirmarReserva);

// DELETE
router.delete('/paquetes/book/:bookingId', C.cancelarReservaIntegracion);
router.post('/paquetes/cancel',           C.cancelarReservaIntegracion);

// 🔹 AHORA USAMOS el controlador de pagos correcto
router.post('/pagos', procesarPagoBanco);

export default router;
