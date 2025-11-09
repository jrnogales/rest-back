import { listPaquetes, getPaqueteByCodigo } from '../models/paqueteModel.js';
import { ensureAndGetDisponibilidad } from '../models/disponibilidadModel.js';
import { crearReserva, cancelarReserva } from '../models/reservaModel.js';

const ok      = (res, data) => res.json({ ok:true, data });
const created = (res, data) => res.status(201).json({ ok:true, data });
const bad     = (res, msg)  => res.status(400).json({ ok:false, error:String(msg) });
const notFound= (res, msg='No encontrado') => res.status(404).json({ ok:false, error: msg });
const fail    = (res, err)  => res.status(500).json({ ok:false, error: (err?.message||String(err)) });

export async function buscarServicios(req, res){
  try{
    const min = req.query.minPrecio ? Number(req.query.minPrecio) : null;
    const max = req.query.maxPrecio ? Number(req.query.maxPrecio) : null;

    const rows = (await listPaquetes()).map(p => ({
      id: String(p.codigo),
      name: p.titulo,
      adultPrice: Number(p.precio_adulto||0),
      childPrice: Number(p.precio_nino||0),
      currency: p.currency || 'USD',
      durationDays: Number(p.duracion_dias||1),
      agencyName: p.agency_name || 'cuenca-travel',
      imageUrl: p.imagen || '',
      description: String(p.descripcion||''),
      stock: Number(p.stock||0)
    }));

    const data = rows.filter(s =>
      (min === null || s.adultPrice >= min) &&
      (max === null || s.adultPrice <= max)
    );

    return ok(res, data);
  } catch (e) { return fail(res, e); }
}

export async function obtenerDetalleServicio(req, res){
  try{
    const p = await getPaqueteByCodigo(req.params.id);
    if(!p) return notFound(res, 'Servicio no encontrado');
    const servicio = {
      id: String(p.codigo),
      name: p.titulo,
      adultPrice: Number(p.precio_adulto||0),
      childPrice: Number(p.precio_nino||0),
      currency: p.currency || 'USD',
      durationDays: Number(p.duracion_dias||1),
      agencyName: p.agency_name || 'cuenca-travel',
      imageUrl: p.imagen || '',
      description: String(p.descripcion||''),
      stock: Number(p.stock||0)
    };
    return ok(res, servicio);
  } catch (e){ return fail(res, e); }
}

export async function verificarDisponibilidad(req, res){
  try{
    const sku = String(req.query.sku||'').trim();
    const inicio = String(req.query.inicio||'').slice(0,10);
    const unidades = Math.max(0, parseInt(req.query.unidades||'0',10));
    if(!sku || !inicio) return bad(res, 'sku e inicio son requeridos');

    const p = await getPaqueteByCodigo(sku);
    if(!p) return notFound(res, 'SKU inválido');

    const disp = await ensureAndGetDisponibilidad(p.id, inicio);
    if(!disp) return bad(res, 'No se pudo leer disponibilidad');

    const libres = Number(disp.cupos_totales) - Number(disp.cupos_reservados);
    return ok(res, { ok: libres >= unidades, libres });
  } catch (e){ return fail(res, e); }
}

export async function cotizarReserva(req, res){
  try{
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    let total = 0; const detail = [];
    for(const it of items){
      const p = await getPaqueteByCodigo(String(it.codigo||''));
      if(!p) continue;
      const ad = Math.max(0, parseInt(it.adultos||'0',10));
      const ni = Math.max(0, parseInt(it.ninos||'0',10));
      const subt = ad*Number(p.precio_adulto||0) + ni*Number(p.precio_nino||0);
      total += subt;
      detail.push({ codigo: p.codigo, subtotal: +subt.toFixed(2) });
    }
    return ok(res, { total: +total.toFixed(2), breakdown: detail });
  } catch (e){ return fail(res, e); }
}

export async function crearPreReserva(req, res){
  try{
    const preBookingId = 'PRE-' + Math.random().toString(36).slice(2,8).toUpperCase();
    const expiraEn = new Date(Date.now() + 10*60000).toISOString();
    return created(res, { preBookingId, expiraEn });
  } catch (e){ return fail(res, e); }
}

export async function confirmarReserva(req, res){
  try{
    const item = req.body?.item || null;
    if(!item) return bad(res, 'item requerido');
    const r = await crearReserva({
      codigo: String(item.codigo||''),
      fecha: String(item.fecha||'').slice(0,10),
      adultos: Number(item.adultos||0),
      ninos: Number(item.ninos||0),
      origen: 'REST-INTEGRACION'
    });
    return created(res, { bookingId: r.codigoReserva, estado: 'CONFIRMADA' });
  } catch (e){ return fail(res, e); }
}

export async function cancelarReservaIntegracion(req, res){
  try{
    const bookingId = String(req.body?.bookingId||'').trim();
    if(!bookingId) return bad(res, 'bookingId requerido');
    await cancelarReserva(bookingId);
    return ok(res, { ok: true });
  } catch (e){ return fail(res, e); }
}
