// src/routes/adminPaquetesRoutes.js
import express from 'express';
import {
  listarPaquetesAdmin,
  crearPaquete,
  actualizarPaquete,
  eliminarPaquete,
  toggleEstadoPaquete
} from '../controllers/adminPaquetesController.js';

const router = express.Router();

// Listar paquetes (ADMIN)
router.get('/', listarPaquetesAdmin);

// Crear paquete
router.post('/', crearPaquete);

// Actualizar paquete
router.put('/:id', actualizarPaquete);

// Eliminar paquete
router.delete('/:id', eliminarPaquete);

// Activar / Inactivar paquete
router.post('/:id/toggle', toggleEstadoPaquete);

export default router;
