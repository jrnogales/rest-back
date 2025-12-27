// src/controllers/adminPaquetesController.js
import {
  listPaquetesAdmin,
  crearPaqueteDB,
  actualizarPaqueteDB,
  eliminarPaqueteDB,
  toggleEstadoPaqueteDB
} from '../models/paqueteModel.js';
import { pools } from '../config/db.js';

export async function listarPaquetesAdmin(req, res) {
  try {
    const rows = await listPaquetesAdmin();
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[listarPaquetesAdmin] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function crearPaquete(req, res) {
  try {
    const { codigo, titulo, descripcion='', imagen='', precio_adulto, precio_nino } = req.body || {};
    if (!codigo || !titulo) {
      return res.status(400).json({ ok:false, error:'codigo y titulo son requeridos' });
    }

    const precioAdulto = Math.max(0, Number(precio_adulto || 0));
    const precioNino   = Math.max(0, Number(precio_nino || 0));

    const created = await crearPaqueteDB({ codigo, titulo, descripcion, imagen, precioAdulto, precioNino });
    return res.status(201).json({ ok:true, data: created });
  } catch (err) {
    console.error('[crearPaquete] error:', err);
    return res.status(500).json({ ok:false, error: err.message });
  }
}

export async function actualizarPaquete(req, res) {
  try {
    const { id } = req.params;
    const { codigo, titulo, descripcion='', imagen='', precio_adulto, precio_nino } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, error:'id requerido' });
    if (!codigo || !titulo) return res.status(400).json({ ok:false, error:'codigo y titulo son requeridos' });

    const precioAdulto = Math.max(0, Number(precio_adulto || 0));
    const precioNino   = Math.max(0, Number(precio_nino || 0));

    const updated = await actualizarPaqueteDB(id, { codigo, titulo, descripcion, imagen, precioAdulto, precioNino });
    if (!updated) return res.status(404).json({ ok:false, error:'Paquete no encontrado' });

    return res.json({ ok:true, data: updated });
  } catch (err) {
    console.error('[actualizarPaquete] error:', err);
    return res.status(500).json({ ok:false, error: err.message });
  }
}

export async function eliminarPaquete(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok:false, error:'id requerido' });

  try {
    // 1) leemos código del paquete en DB paquetes
    const { rows } = await pools.paquetes.query(`SELECT codigo FROM paquetes WHERE id=$1 LIMIT 1`, [Number(id)]);
    const codigo = rows[0]?.codigo;
    if (!codigo) return res.status(404).json({ ok:false, error:'Paquete no encontrado' });

    // 2) borrar disponibilidad y carrito (en sus DB)
    await pools.reservas.query(`DELETE FROM disponibilidad WHERE paquete_codigo=$1`, [String(codigo)]).catch(()=>{});
    await pools.carrito.query(`DELETE FROM carrito WHERE paquete_id::text=$1 OR paquete_codigo=$1`, [String(codigo)]).catch(()=>{});

    // 3) borrar paquete en DB paquetes
    const ok = await eliminarPaqueteDB(id);
    if (!ok) return res.status(404).json({ ok:false, error:'Paquete no encontrado' });

    return res.status(200).json({ ok:true });
  } catch (err) {
    console.error('[eliminarPaquete] error:', err);
    return res.status(500).json({ ok:false, error: err.message });
  }
}

export async function toggleEstadoPaquete(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ ok:false, error:'id requerido' });

    const r = await toggleEstadoPaqueteDB(id);
    if (!r) return res.status(404).json({ ok:false, error:'Paquete no encontrado' });

    return res.json({ ok:true, data: { estado: r.estado } });
  } catch (err) {
    console.error('[toggleEstadoPaquete] error:', err);
    return res.status(500).json({ ok:false, error: err.message });
  }
}
