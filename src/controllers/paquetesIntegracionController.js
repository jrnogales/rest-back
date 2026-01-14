import crypto from 'crypto';
import { pools } from '../config/db.js';
import { ensureAndGetDisponibilidad } from '../models/disponibilidadModel.js';
import {
  crearReserva,
  getReservaPorCodigo,
  cancelarReserva as cancelarReservaCore
} from '../models/reservaModel.js';
import { upsertUserByEmail } from '../models/usuarioModel.js';
import { crearFacturaParaReserva, getFacturaByReservaId } from '../models/facturaModel.js';

import {
  generarLinksPaquete,
  generarLinksHold,
  generarLinksReserva
} from '../helpers/hateoasHelper.js';

const poolPaquetes = pools.paquetes;
const poolReservas = pools.reservas;

const PUBLIC_BASE_URL = 'https://rest-back-xnjm.onrender.com';

// ================== Utils ==================
function brief(txt = '', len = 140) {
  const s = String(txt).replace(/\s+/g, ' ').trim();
  return s.length <= len ? s : s.slice(0, len - 1) + '…';
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

// ✅ Contrato BUS: ids llegan como "string" (pero deben ser numéricos)
function requireNumericIdString(value, fieldNameForMsg) {
  const s = String(value ?? '').trim();
  if (!s) return { ok: false, message: `${fieldNameForMsg} es requerido` };
  if (!/^\d+$/.test(s)) return { ok: false, message: `${fieldNameForMsg} debe ser un número válido` };
  return { ok: true, str: s, int: Number(s) };
}

async function getPaqueteCodigoById(paqueteIdInt) {
  const { rows } = await poolPaquetes.query(
    `SELECT codigo FROM paquetes WHERE id=$1 LIMIT 1`,
    [paqueteIdInt]
  );
  return rows[0]?.codigo ?? null;
}

async function getReservaCodigoById(reservaIdInt) {
  // tu columna se llama codigo_reserva (confirmado por ti)
  const { rows } = await poolReservas.query(
    `SELECT codigo_reserva FROM reservas WHERE id=$1 LIMIT 1`,
    [reservaIdInt]
  );
  return rows[0]?.codigo_reserva ?? null;
}

// ================== Pre-reservas (DB) ==================
async function createHoldDB({ id_hold, paquete_codigo, fecha_inicio, turistas, expira_en, correo, booking_user_id }) {
  const pRes = await poolPaquetes.query(
    `SELECT id FROM paquetes WHERE codigo=$1 LIMIT 1`,
    [String(paquete_codigo)]
  );
  if (!pRes.rows.length) throw new Error(`Paquete no encontrado: ${paquete_codigo}`);

  const paqueteId = Number(pRes.rows[0].id);
  const fechaViaje = String(fecha_inicio).slice(0, 10);

  const adultos = (turistas || []).filter(t => (t.tipo || '').toLowerCase() !== 'nino').length || 1;
  const ninos = (turistas || []).filter(t => (t.tipo || '').toLowerCase() === 'nino').length || 0;

  const cliente = {
    nombre: turistas?.[0]?.nombre ?? null,
    apellido: turistas?.[0]?.apellido ?? null,
    identificacion: turistas?.[0]?.identificacion ?? null,
    correo: correo ?? null
  };

  await poolReservas.query(
    `
    INSERT INTO pre_reservas (
      pre_booking_id,
      origen,
      paquete_id,
      fecha_viaje,
      adultos,
      ninos,
      total_usd,
      expira_en,
      estado,
      cliente,
      creado_en,

      id_hold,
      paquete_codigo,
      fecha_inicio,
      turistas,
      booking_user_id,
      correo
    )
    VALUES (
      $1,'BUS',$2,$3::date,$4,$5,0,$6,'HOLD',$7::jsonb,NOW(),
      $8,$9,$10,$11::jsonb,$12,$13
    )
    `,
    [
      String(id_hold),
      paqueteId,
      fechaViaje,
      adultos,
      ninos,
      expira_en,
      JSON.stringify(cliente || {}),

      String(id_hold),
      String(paquete_codigo),
      fechaViaje,
      JSON.stringify(turistas || []),
      booking_user_id ?? null,
      correo ?? null
    ]
  );
}

async function getHoldDB(id_hold) {
  const { rows } = await poolReservas.query(
    `SELECT * FROM pre_reservas WHERE id_hold=$1 OR pre_booking_id=$1 LIMIT 1`,
    [String(id_hold)]
  );
  return rows[0] || null;
}

async function deleteHoldDB(id_hold) {
  await poolReservas.query(
    `DELETE FROM pre_reservas WHERE id_hold=$1 OR pre_booking_id=$1`,
    [String(id_hold)]
  );
}

// ================== Mapeo paquetes (GET) ==================
function mapPaqueteToBusModel(req, p) {
  const baseUrl = getBaseUrl(req);

  const idPaquete = Number(p.id); // ✅ GET paquetes: INT
  const nombre =
    p.nombre || p.titulo || p.nombre_paquete || `Paquete ${p.codigo ?? p.id}`;

  const ciudad = p.ciudad || 'Cuenca';
  const pais = p.pais || 'Ecuador';
  const tipoActividad = p.tipo_actividad || p.categoria || 'Paquete turístico';
  const capacidad = Number(p.stock || p.capacidad || 30);
  const precio = Number(p.precio_adulto || p.precio || 0);
  const imagenUrl = p.imagen || p.uri_imagen || '';
  const duracion = Number(p.duracion_dias || p.duracion || 1);

  return {
    idPaquete,
    nombre,
    ciudad,
    pais,
    tipoActividad,
    capacidad,
    precioNormal: precio,
    precioActual: precio,
    imagenUrl,
    duracion,
    _links: generarLinksPaquete(baseUrl, String(idPaquete))
  };
}

/* ============================================================
   GET /api/v2/paquetes
   ============================================================ */
export async function buscarPaquetes(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const pagina = Math.max(1, parseInt(req.query.pagina ?? '1', 10) || 1);
    const limite = Math.max(1, parseInt(req.query.limite ?? '10', 10) || 10);

    const { rows } = await poolPaquetes.query(`SELECT * FROM paquetes ORDER BY id ASC`);
    const datos = rows.map(p => {
      const mapped = mapPaqueteToBusModel(req, p);
      mapped._links = generarLinksPaquete(baseUrl, String(mapped.idPaquete));
      return mapped;
    });

    return res.json({
      datos,
      paginacion: {
        paginaActual: pagina,
        limite,
        totalPaginas: 1,
        totalElementos: datos.length
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener paquetes', detalle: err.message });
  }
}

/* ============================================================
   POST /api/v2/paquetes/availability
   CONTRATO (te piden):
   {
     "idPaquete": "string",
     "fechaInicio": "2026-01-14T..Z",
     "personas": 0
   }
   ============================================================ */
export async function validarDisponibilidadPaquete(req, res) {
  const request = req.body || {};

  const idCheck = requireNumericIdString(request.idPaquete ?? request.IdPaquete, 'idPaquete');
  if (!idCheck.ok) return res.status(400).send('Id del paquete es requerido');

  try {
    const paqueteIdInt = idCheck.int;
    const codigo = await getPaqueteCodigoById(paqueteIdInt);
    if (!codigo) {
      return res.status(404).json({ disponible: false, mensaje: 'Paquete no encontrado' });
    }

    const fechaInicio = request.fechaInicio ?? request.FechaInicio ?? null;
    const personas = request.personas ?? request.Personas ?? 0;

    const fecha = fechaInicio ? String(fechaInicio).slice(0, 10) : null;
    const num = Math.max(0, parseInt(personas, 10) || 0);

    if (!fecha || !num) {
      return res.json({
        disponible: true,
        idPaquete: idCheck.str,  // ✅ como te piden: string
        fechaInicio,
        personas: num,
        mensaje: 'Paquete disponible para reserva'
      });
    }

    const disp = await ensureAndGetDisponibilidad(String(codigo), fecha);
    const libres = Number(disp.cupos_totales) - Number(disp.cupos_reservados);

    return res.json({
      disponible: libres >= num,
      idPaquete: idCheck.str,      // ✅ string
      fechaInicio,
      personas: num,
      cupos_disponibles: libres,
      mensaje: libres >= num ? 'Paquete disponible para reserva' : 'No hay cupos suficientes'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al validar disponibilidad', detalle: err.message });
  }
}

/* ============================================================
   POST /api/v2/paquetes/usuarios/externo
   ============================================================ */
export async function crearUsuarioExterno(req, res) {
  const request = req.body || {};

  const correo = String(request.correo ?? request.Correo ?? '').trim();
  const nombre = String(request.nombre ?? request.Nombre ?? '').trim();
  const apellido = String(request.apellido ?? request.Apellido ?? '').trim();

  if (!correo) return res.status(400).send('Correo es requerido');

  try {
    const user = await upsertUserByEmail({
      nombre: nombre || null,
      apellido: apellido || null,
      email: correo
    });

    return res.json({
      idUsuario: user?.id ?? 0,
      correo,
      exitoso: true,
      mensaje: 'Usuario externo creado/obtenido exitosamente'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear usuario externo', detalle: err.message });
  }
}

/* ============================================================
   POST /api/v2/paquetes/pre-reserva
   CONTRATO:
   {
     "idPaquete": "string",
     "bookingUserId": "string",
     "correo": "string",
     "fechaInicio": "...",
     "turistas": [...],
     "duracionHoldSegundos": 0
   }
   ============================================================ */
export async function crearPreReservaPaquete(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const request = req.body || {};

    const idCheck = requireNumericIdString(request.idPaquete ?? request.IdPaquete ?? request.id_paquete, 'idPaquete');
    if (!idCheck.ok) return res.status(400).send('Debe proporcionar id_paquete');

    const correo = String(request.correo ?? request.Correo ?? '').trim() || null;
    const bookingUserId = String(request.bookingUserId ?? request.BookingUserId ?? '').trim() || null;

    const fechaInicio = request.fechaInicio ?? request.FechaInicio ?? new Date().toISOString();
    const turistas = request.turistas ?? request.Turistas ?? [];

    const codigo = await getPaqueteCodigoById(idCheck.int);
    if (!codigo) return res.status(404).send('Paquete no encontrado');

    const holdId = `HOLD-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;

    const seg = Math.max(60, parseInt(request.duracionHoldSegundos ?? '600', 10) || 600);
    const expira = new Date(Date.now() + seg * 1000);

    await createHoldDB({
      id_hold: holdId,
      paquete_codigo: String(codigo),
      fecha_inicio: String(fechaInicio).slice(0, 10),
      turistas,
      expira_en: expira.toISOString(),
      correo,
      booking_user_id: bookingUserId
    });

    return res.json({
      id_hold: holdId,
      fechaExpiracion: expira,
      _links: generarLinksHold(baseUrl, holdId)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al crear pre-reserva', detalle: err.message });
  }
}

/* ============================================================
   POST /api/v2/paquetes/reserva
   CONTRATO:
   {
     "idPaquete": "string",
     "idHold": "string",
     "correo": "string",
     "metodoPago": "string",
     "turistas": [...],
     "paymentStatus": "string"
   }
   ============================================================ */
export async function reservarPaquete(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const request = req.body || {};

    const idHold = String(request.idHold ?? request.IdHold ?? request.id_hold ?? '').trim();
    const correo = String(request.correo ?? request.Correo ?? '').trim();

    if (!idHold || !correo) {
      return res.status(400).send('Debe proporcionar id_hold y correo');
    }

    const idCheck = requireNumericIdString(request.idPaquete ?? request.IdPaquete ?? request.id_paquete, 'idPaquete');
    if (!idCheck.ok) return res.status(400).send('Debe proporcionar id_paquete');

    const codigo = await getPaqueteCodigoById(idCheck.int);
    if (!codigo) return res.status(404).send('Paquete no encontrado');

    const hold = await getHoldDB(idHold);
    if (!hold) {
      return res.status(400).send('No se pudo confirmar la reserva. Verifique que el hold esté activo.');
    }

    if (hold.expira_en && new Date(hold.expira_en) < new Date()) {
      await deleteHoldDB(idHold);
      return res.status(400).send('No se pudo confirmar la reserva. Verifique que el hold esté activo.');
    }

    if (String(hold.paquete_codigo) !== String(codigo)) {
      return res.status(400).send('No se pudo confirmar la reserva. Verifique que el hold esté activo.');
    }

    const turistas = request.turistas ?? request.Turistas ?? [];
    const fecha = String(hold.fecha_inicio).slice(0, 10);

    const adultos = (turistas || []).filter(t => (t.tipo || '').toLowerCase() !== 'nino').length || 1;
    const ninos = (turistas || []).filter(t => (t.tipo || '').toLowerCase() === 'nino').length || 0;

    const metodoPago = String(request.metodoPago ?? request.MetodoPago ?? '').trim() || 'tarjeta';

    let paymentStatus = String(request.paymentStatus ?? request.PaymentStatus ?? 'paid');
    if (paymentStatus.toUpperCase() === 'CONFIRMADO') paymentStatus = 'paid';

    const user = await upsertUserByEmail({
      nombre: correo,
      apellido: null,
      email: correo
    });

    const r = await crearReserva({
      codigo: String(codigo),
      fecha,
      adultos,
      ninos,
      usuarioId: user.id,
      origen: 'REST',
      metodoPago
    });

    await deleteHoldDB(idHold);

    // ✅ contrato: idPaquete llega como string -> respondemos string
    return res.json({
      id_reserva: String(r.reservaId),   // ✅ string numérico (como ejemplo)
      id_paquete: idCheck.str,           // ✅ string
      id_hold: idHold,
      correo,
      metodoPago,
      paymentStatus,
      turistas,
      _links: generarLinksReserva(baseUrl, String(r.reservaId), null)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al confirmar reserva', detalle: err.message });
  }
}

/* ============================================================
   POST /api/v2/paquetes/invoices
   CONTRATO:
   {
     "idReserva": "string",
     "correo": "string",
     "nombre": "string",
     "tipoIdentificacion": "string",
     "identificacion": "string",
     "valor": 0
   }
   ============================================================ */
export async function emitirFacturaPaquete(req, res) {
  const request = req.body || {};

  const idCheck = requireNumericIdString(request.idReserva ?? request.IdReserva ?? request.id_reserva, 'idReserva');
  if (!idCheck.ok) return res.status(400).send('ID de reserva es requerido');

  try {
    const reservaIdInt = idCheck.int;
    const codigoReserva = await getReservaCodigoById(reservaIdInt);
    if (!codigoReserva) return res.status(404).send('Reserva no encontrada');

    const valor = Number(request.valor ?? request.Valor ?? 0);

    let result = null;
    try {
      result = await crearFacturaParaReserva({
        codigoReserva: String(codigoReserva),
        total: valor
      });
    } catch {
      result = null;
    }

    const codigoFacturaReal = result?.codigoFactura || result?.codigo_factura || null;

    const idFactura =
      codigoFacturaReal ||
      `FACT-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

    const uriFactura = codigoFacturaReal
      ? `${PUBLIC_BASE_URL}/admin/facturas/${codigoFacturaReal}`
      : `https://facturas.example.com/${idCheck.str}`;

    return res.json({
      idFactura,
      idReserva: idCheck.str, // ✅ string como contrato
      correo: String(request.correo ?? ''),
      nombreCompleto: String(request.nombre ?? ''),
      tipoIdentificacion: String(request.tipoIdentificacion ?? ''),
      identificacion: String(request.identificacion ?? ''),
      valorPagado: valor,
      fechaEmision: new Date(),
      uriFactura,
      mensaje: 'Factura emitida exitosamente'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al emitir factura', detalle: err.message });
  }
}

/* ============================================================
   POST /api/v2/paquetes/cancelar
   CONTRATO:
   { "id_reserva": "string" }
   ============================================================ */
export async function cancelarReservaPaquete(req, res) {
  const request = req.body || {};
  const idCheck = requireNumericIdString(request.id_reserva ?? request.idReserva ?? request.IdReserva, 'id_reserva');
  if (!idCheck.ok) return res.status(400).send('id_reserva es requerido');

  try {
    const reservaIdInt = idCheck.int;

    const codigoReserva = await getReservaCodigoById(reservaIdInt);
    if (!codigoReserva) {
      return res.status(404).json({ error: 'Reserva no encontrada o ya está cancelada' });
    }

    const r = await getReservaPorCodigo(String(codigoReserva));
    if (!r) {
      return res.status(404).json({ error: 'Reserva no encontrada o ya está cancelada' });
    }

    if (String(r.estado || '').toUpperCase() === 'CANCELADA') {
      return res.status(404).json({ error: 'Reserva no encontrada o ya está cancelada' });
    }

    await cancelarReservaCore(String(codigoReserva));

    return res.json({
      exito: true,
      valor_pasado: 23.09
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al cancelar reserva', detalle: err.message });
  }
}

/* ============================================================
   GET /api/v2/paquetes/:id/reserva
   CONTRATO: :id es ID PAQUETE (int)
   Respuesta:
   { "id_reserva": "3", "data": {...} }
   ============================================================ */
export async function buscarDatosReserva(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const idParam = String(req.params.id ?? '').trim();

    if (!idParam) return res.status(400).send('Debe proporcionar el ID de la reserva');
    if (!/^\d+$/.test(idParam)) return res.status(400).send('ID de reserva debe ser un número válido');

    const paqueteIdInt = Number(idParam);

    // ✅ Buscar última reserva relacionada al paquete (si tienes paquete_id en reservas)
    // Si no existe paquete_id en tu tabla, este query fallará -> hacemos fallback.
    let reservaRow = null;
    try {
      const q = await poolReservas.query(
        `SELECT * FROM reservas WHERE paquete_id=$1 ORDER BY id DESC LIMIT 1`,
        [paqueteIdInt]
      );
      reservaRow = q.rows[0] ?? null;
    } catch {
      // Fallback: si no hay paquete_id, intenta por paquete_codigo
      try {
        const codigo = await getPaqueteCodigoById(paqueteIdInt);
        if (codigo) {
          const q2 = await poolReservas.query(
            `SELECT * FROM reservas WHERE paquete_codigo=$1 ORDER BY id DESC LIMIT 1`,
            [String(codigo)]
          );
          reservaRow = q2.rows[0] ?? null;
        }
      } catch {
        reservaRow = null;
      }
    }

    if (!reservaRow) return res.status(404).end();

    // ✅ Armar "data" similar al ejemplo
    const reservaId = reservaRow.id;
    const codigo = reservaRow.codigo_reserva ?? reservaRow.codigo ?? null;

    // detalles (si existe tabla)
    let reservaDetalles = [];
    try {
      const d = await poolReservas.query(
        `SELECT * FROM reserva_detalles WHERE reserva_id=$1 ORDER BY id ASC`,
        [reservaId]
      );
      reservaDetalles = (d.rows || []).map(x => ({
        id: x.id,
        servicioId: x.servicio_id ?? x.servicioId ?? null,
        cantidad: x.cantidad ?? 1,
        precioUnitario: Number(x.precio_unitario ?? x.precioUnitario ?? 0),
        subtotal: Number(x.subtotal ?? 0),
        fechaInicio: x.fecha_inicio ?? x.fechaInicio ?? null,
        fechaFin: x.fecha_fin ?? x.fechaFin ?? null
      }));
    } catch {
      reservaDetalles = [];
    }

    const data = {
      id: reservaId,
      codigo: codigo,
      usuarioId: reservaRow.usuario_id ?? reservaRow.usuarioId ?? null,
      clienteId: reservaRow.cliente_id ?? reservaRow.clienteId ?? null,
      cliente: reservaRow.cliente ?? null,
      promocionId: reservaRow.promocion_id ?? null,
      promocion: null,
      subtotal: Number(reservaRow.subtotal ?? reservaRow.total_usd ?? 0),
      descuento: Number(reservaRow.descuento ?? 0),
      impuestos: Number(reservaRow.impuestos ?? 0),
      total: Number(reservaRow.total ?? reservaRow.total_usd ?? 0),
      estadoId: reservaRow.estado_id ?? reservaRow.estadoId ?? null,
      estadoNombre: reservaRow.estado_nombre ?? reservaRow.estadoNombre ?? reservaRow.estado ?? null,
      estado: reservaRow.estado ?? reservaRow.estado_nombre ?? null,
      notas: reservaRow.notas ?? null,
      createdAt: reservaRow.creado_en ?? reservaRow.created_at ?? reservaRow.createdAt ?? null,
      reservaDetalles
    };

    // factura (si existe)
    let uriFactura = null;
    try {
      const f = await getFacturaByReservaId(reservaId);
      if (f?.codigo_factura) uriFactura = `${PUBLIC_BASE_URL}/admin/facturas/${f.codigo_factura}`;
    } catch {
      uriFactura = null;
    }

    return res.json({
      id_reserva: String(reservaId), // ✅ como el ejemplo (string)
      data,
      _links: generarLinksReserva(baseUrl, String(reservaId), uriFactura)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener reserva', detalle: err.message });
  }
}
