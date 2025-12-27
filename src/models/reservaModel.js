// src/models/reservaModel.js
import { pools } from '../config/db.js';

const poolReservas = pools.reservas;
const poolPaquetes = pools.paquetes;

async function getPaqueteSnapshotPorCodigo(codigo) {
  const { rows } = await poolPaquetes.query(
    `SELECT codigo, titulo, imagen, precio_adulto, precio_nino
       FROM paquetes
      WHERE codigo=$1
      LIMIT 1`,
    [String(codigo)]
  );
  return rows[0] || null;
}

export async function crearReserva({
  codigo,
  fecha,
  adultos = 1,
  ninos = 0,
  origen = 'REST',
  usuarioId = null
}) {
  const paquete = await getPaqueteSnapshotPorCodigo(codigo);
  if (!paquete) throw new Error('Paquete no encontrado');

  const solicitados = Number(adultos || 0) + Number(ninos || 0);
  if (solicitados <= 0) throw new Error('Cantidad inválida');

  const client = await poolReservas.connect();
  try {
    await client.query('BEGIN');

    // asegurar disponibilidad por paquete_codigo + fecha
    await client.query(
      `
      INSERT INTO disponibilidad (paquete_codigo, fecha, cupos_totales, cupos_reservados)
      VALUES ($1,$2,30,0)
      ON CONFLICT (paquete_codigo, fecha) DO NOTHING
      `,
      [String(paquete.codigo), String(fecha)]
    );

    const { rows: drows } = await client.query(
      `
      SELECT id, cupos_totales, cupos_reservados
        FROM disponibilidad
       WHERE paquete_codigo=$1 AND fecha=$2
       FOR UPDATE
      `,
      [String(paquete.codigo), String(fecha)]
    );
    if (!drows.length) throw new Error('No hay disponibilidad');

    const d = drows[0];
    const disponibles = Number(d.cupos_totales) - Number(d.cupos_reservados);
    if (disponibles < solicitados) throw new Error(`Stock insuficiente (${disponibles})`);

    // total con precios del snapshot
    const total =
      Number(adultos || 0) * Number(paquete.precio_adulto || 0) +
      Number(ninos || 0) * Number(paquete.precio_nino || 0);

    const code =
      'RES-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    // Guardamos snapshot dentro de reservas
    const rInsert = await client.query(
      `
      INSERT INTO reservas
        (codigo_reserva, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen, estado,
         paquete_codigo, paquete_titulo, paquete_imagen, precio_adulto, precio_nino)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,'CONFIRMADA',
         $8,$9,$10,$11,$12)
      RETURNING id
      `,
      [
        code,
        usuarioId,
        String(fecha),
        Number(adultos || 0),
        Number(ninos || 0),
        total,
        String(origen),
        String(paquete.codigo),
        String(paquete.titulo || ''),
        String(paquete.imagen || ''),
        Number(paquete.precio_adulto || 0),
        Number(paquete.precio_nino || 0),
      ]
    );

    const reservaId = rInsert.rows[0].id;

    await client.query(
      `
      UPDATE disponibilidad
         SET cupos_reservados = cupos_reservados + $1
       WHERE paquete_codigo=$2 AND fecha=$3
      `,
      [solicitados, String(paquete.codigo), String(fecha)]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      codigoReserva: code,
      total,
      usuarioId,
      estado: 'CONFIRMADA',
      reservaId,
      paqueteCodigo: paquete.codigo,
      paqueteTitulo: paquete.titulo,
      paqueteImagen: paquete.imagen
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function getReservaPorCodigo(codigoReserva) {
  const { rows } = await poolReservas.query(
    `
    SELECT *
      FROM reservas
     WHERE codigo_reserva=$1
     LIMIT 1
    `,
    [String(codigoReserva)]
  );
  return rows[0] || null;
}

export async function cancelarReserva(bookingId) {
  const id = String(bookingId || '').trim();
  if (!id) throw new Error('bookingId requerido');

  const client = await poolReservas.connect();
  try {
    await client.query('BEGIN');

    const rRes = await client.query(
      `
      SELECT id, codigo_reserva, paquete_codigo, fecha_viaje, adultos, ninos, estado, total_usd
        FROM reservas
       WHERE codigo_reserva=$1
       LIMIT 1
      `,
      [id]
    );

    const r = rRes.rows[0];
    if (!r) throw new Error('Reserva no encontrada');

    if (r.estado === 'CANCELADA') {
      await client.query('ROLLBACK');
      return { ok: true };
    }

    const cupos = Number(r.adultos || 0) + Number(r.ninos || 0);

    // formateo fecha
    const fechaRaw = r.fecha_viaje;
    let fechaSql;
    if (fechaRaw instanceof Date) fechaSql = fechaRaw.toISOString().slice(0, 10);
    else fechaSql = String(fechaRaw).slice(0, 10);

    await client.query(
      `
      UPDATE disponibilidad
         SET cupos_reservados = GREATEST(cupos_reservados - $1, 0)
       WHERE paquete_codigo=$2 AND fecha=$3
      `,
      [cupos, String(r.paquete_codigo), fechaSql]
    );

    await client.query(
      `UPDATE reservas SET estado='CANCELADA' WHERE id=$1`,
      [r.id]
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function getReservasPorUsuario(usuarioId) {
  const { rows } = await poolReservas.query(
    `
    SELECT
      codigo_reserva,
      fecha_viaje,
      adultos,
      ninos,
      total_usd,
      COALESCE(estado,'CONFIRMADA') AS estado,
      paquete_titulo AS titulo,
      paquete_imagen AS imagen
    FROM reservas
    WHERE usuario_id=$1
    ORDER BY fecha_viaje DESC, id DESC
    `,
    [Number(usuarioId)]
  );
  return rows;
}

// Admin: listado simple (sin joins)
export async function listarReservasAdminDB() {
  const { rows } = await poolReservas.query(
    `
    SELECT
      id, codigo_reserva, fecha_viaje, adultos, ninos, total_usd,
      COALESCE(estado,'CONFIRMADA') AS estado,
      paquete_titulo, paquete_codigo,
      usuario_id
    FROM reservas
    ORDER BY fecha_viaje DESC, id DESC
    `
  );
  return rows;
}
