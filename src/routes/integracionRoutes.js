import express from 'express';
import * as C from '../controllers/integracionController.js';
const router = express.Router();

router.get('/servicios', C.buscarServicios);
router.get('/servicios/:id', C.obtenerDetalleServicio);
router.get('/disponibilidad', C.verificarDisponibilidad);
router.post('/cotizar', C.cotizarReserva);
router.post('/prereservas', C.crearPreReserva);
router.post('/confirmar', C.confirmarReserva);
router.post('/cancelar', C.cancelarReservaIntegracion);

export default router;
