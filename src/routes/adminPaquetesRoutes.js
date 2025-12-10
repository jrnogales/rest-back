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

// Activar / Inactivar paquete
router.post('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `
      UPDATE paquetes
      SET estado = CASE
                      WHEN estado = 'activo' THEN 'inactivo'
                      ELSE 'activo'
                   END
      WHERE id = $1
      RETURNING estado;
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Paquete no encontrado" });
    }

    return res.redirect('/admin/paquetes');
  } catch (err) {
    console.error('[togglePaquete] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});


export default router;
