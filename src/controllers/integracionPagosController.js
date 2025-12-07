// src/controllers/integracionPagosController.js
import { realizarPagoBanco } from '../services/bancoService.js';

export async function procesarPago(req, res) {
  try {
    const { cuentaOrigen, monto } = req.body;

    if (!cuentaOrigen || !monto) {
      return res.status(400).json({
        ok: false,
        error: 'cuentaOrigen y monto son requeridos'
      });
    }

    const pago = await realizarPagoBanco({ cuentaOrigen, monto });

    return res.status(201).json({
      ok: true,
      data: pago
    });

  } catch (err) {
    console.error('[procesarPago] error', err);
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
