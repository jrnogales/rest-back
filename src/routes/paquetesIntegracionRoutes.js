// src/routes/paquetesIntegracionRoutes.js
import { Router } from 'express';
import {
  buscarPaquetes,
  validarDisponibilidadPaquete,
  crearPreReservaPaquete,
  reservarPaquete,
  crearUsuarioExterno,
  emitirFacturaPaquete,
  buscarDatosReserva
} from '../controllers/paquetesIntegracionController.js';

const router = Router();

// GET base → buscarPaquetes()
router.get('/', buscarPaquetes);

// POST availability
router.post('/availability', validarDisponibilidadPaquete);

// POST pre-reserva
router.post('/pre-reserva', crearPreReservaPaquete);

// POST reserva
router.post('/reserva', reservarPaquete);

// POST crear usuario externo
router.post('/usuarios/externo', crearUsuarioExterno);

// POST emitir factura
router.post('/invoices', emitirFacturaPaquete);

// GET datos reserva por código
router.get('/:id/reserva', buscarDatosReserva);

export default router;
