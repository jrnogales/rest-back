// src/routes/integracionRoutes.js
import express from 'express';
import * as C from '../controllers/integracionController.js';

const router = express.Router();

// GET
router.get('/paquetes/search',        C.buscarServicios);
// 👇 MOVER ESTA ANTES de /:id
router.get('/paquetes/availability',  C.verificarDisponibilidad);
router.get('/paquetes/:id',           C.obtenerDetalleServicio);

// POST
router.post('/paquetes/quote',        C.cotizarReserva);
router.post('/paquetes/hold',         C.crearPreReserva);
router.post('/paquetes/book',         C.confirmarReserva);

// DELETE RESTful (nivel 2 verbos HTTP)
router.delete('/paquetes/book/:bookingId', C.cancelarReservaIntegracion);

// Compatibilidad con lo que ya tenías (POST /cancel)
router.post('/paquetes/cancel',       C.cancelarReservaIntegracion);

export default router;
