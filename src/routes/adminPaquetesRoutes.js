// src/routes/adminPaquetesRoutes.js
import express from 'express';
import {
  crearPaquete,
  actualizarPaquete,
  eliminarPaquete
} from '../controllers/adminPaquetesController.js';

const router = express.Router();

// Crear paquete
router.post('/', crearPaquete);

// Actualizar paquete
router.put('/:id', actualizarPaquete);

// Eliminar paquete
router.delete('/:id', eliminarPaquete);

export default router;
