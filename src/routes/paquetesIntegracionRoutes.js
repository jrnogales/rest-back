// src/routes/paquetesIntegracionRoutes.js
import { Router } from 'express';
import {
  buscarPaquetes,
  validarDisponibilidadPaquete,
  crearPreReservaPaquete,
  reservarPaquete,
  crearUsuarioExterno,
  emitirFacturaPaquete,
  buscarDatosReserva,
  cancelarReservaPaquete
} from '../controllers/paquetesIntegracionController.js';

const router = Router();

// GET paquetes
router.get('/', buscarPaquetes);

// POST availability
router.post('/availability', validarDisponibilidadPaquete);

// POST pre-reserva (hold)
router.post('/pre-reserva', crearPreReservaPaquete);

// POST reserva (confirm)
router.post('/reserva', reservarPaquete);

// POST crear usuario externo
router.post('/usuarios/externo', crearUsuarioExterno);

// POST emitir factura
router.post('/invoices', emitirFacturaPaquete);

// GET datos reserva por id
router.get('/:id/reserva', buscarDatosReserva);

// POST cancelar
router.post('/cancelar', cancelarReservaPaquete);

export default router;
