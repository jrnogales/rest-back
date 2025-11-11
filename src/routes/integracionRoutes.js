import express from 'express';
import * as C from '../controllers/integracionController.js';

const router = express.Router();

router.get('/paquetes/search', C.buscarServicios);
router.get('/paquetes/:id',   C.obtenerDetalleServicio);
router.get('/paquetes/availability', C.verificarDisponibilidad);
router.post('/paquetes/quote',      C.cotizarReserva);
router.post('/paquetes/hold',       C.crearPreReserva);
router.post('/paquetes/book',       C.confirmarReserva);
router.post('/paquetes/cancel',     C.cancelarReservaIntegracion);

export default router;
