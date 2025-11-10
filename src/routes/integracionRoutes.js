// src/routes/integracionRoutes.js
import express from 'express';
import * as C from '../controllers/integracionController.js';

const router = express.Router();

/**
 * Base final: /api/integracion/paquetes/...
 * (server.js monta este router en /api/integracion)
 */

// search
router.get('/paquetes/search', C.buscarServicios);

// detail/:id
router.get('/paquetes/detail/:id', C.obtenerDetalleServicio);

// availability?sku=...&inicio=YYYY-MM-DD&unidades=#
router.get('/paquetes/availability', C.verificarDisponibilidad);

// quote  (body: { items: [{codigo, adultos, ninos}] })
router.post('/paquetes/quote', C.cotizarReserva);

// hold   (body opcional, retorna preBookingId y expiraEn)
router.post('/paquetes/hold', C.crearPreReserva);

// book   (body: { item: { codigo, fecha, adultos, ninos } })
router.post('/paquetes/book', C.confirmarReserva);

// cancel (body: { bookingId })
router.post('/paquetes/cancel', C.cancelarReservaIntegracion);

export default router;
export { router };
