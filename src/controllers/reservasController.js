// src/controllers/reservasController.js
import { getReservasPorUsuario } from "../models/reservaModel.js";

export async function listarPorUsuario(req, res) {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ ok: false, error: "id requerido" });
    }

    const reservas = await getReservasPorUsuario(id);

    return res.json({
      ok: true,
      data: reservas,
    });
  } catch (e) {
    console.error("[REST reservas] Error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e.message || "Error interno" });
  }
}
