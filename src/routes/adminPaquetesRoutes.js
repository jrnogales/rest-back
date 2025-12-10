// src/routes/adminPaquetesRoutes.js
import express from 'express';
import {
  crearPaquete,
  actualizarPaquete,
  eliminarPaquete,
  toggleEstadoPaquete
} from '../controllers/adminPaquetesController.js';

const router = express.Router();

// Crear paquete
router.post('/', crearPaquete);

// Actualizar paquete
router.put('/:id', actualizarPaquete);

// Eliminar paquete (si lo sigues usando en algún lado)
router.delete('/:id', eliminarPaquete);

// Activar / Inactivar paquete
router.post('/:id/toggle', toggleEstadoPaquete);

export default router;
