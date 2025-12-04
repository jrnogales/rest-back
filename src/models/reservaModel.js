// src/models/reservaModel.js
import { pool } from '../config/db.js';

/**
 * Crea una reserva con control de stock y disponibilidad.
 * Retorna:
 * {
 *   ok: true,
 *   codigoReserva: 'RES-...',
 *   total: <number>,
 *   reserva: <fila completa de la tabla reservas>
 * }
 */
export async function crearReserva({
  codigo,
  fecha,
  adultos = 1,
  ninos = 0,
  origen = 'REST',
  usuarioId = null
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1) Obtener paquete
    const pRes = await client.query(
      'SELECT * FROM paquetes WHERE codigo = $1 LIMIT 1',
      [String(codigo)]
    );
    const p = pRes.rows[0];
    if (!p) throw new Error('Paquete no encontrado');

    // 2) Validar cantidad solicitada
    const solicitados = Number(adultos || 0) + Number(ninos || 0);
    if (solicitados <= 0) throw new Error('Cantidad inválida');

    // 3) Asegurar fila de disponibilidad (cupos_totales = 30 por defecto)
    await client.query(
      `
      INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
      VALUES ($1, $2, 30, 0)
      ON CONFLICT (paquete_id, fecha) DO NOTHING
      `,
      [p.id, String(fecha)]
    );

    // 4) Bloquear fila de disponibilidad para este paquete/fecha
    const { rows } = await client.query(
      `
      SELECT id, cupos_totales, cupos_reservados
        FROM disponibilidad
       WHERE paquete_id = $1 AND fecha = $2
       FOR UPDATE
      `,
      [p.id, String(fecha)]
    );

    if (rows.length === 0) throw new Error('No hay disponibilidad');
    const d = rows[0];

    const disponibles = Number(d.cupos_totales) - Number(d.cupos_reservados);
    if (disponibles < solicitados) {
      throw new Error(`Stock insuficiente (${disponibles})`);
    }

    // 5) Calcular total
    const total =
      Number(adultos || 0) * Number(p.precio_adulto || 0) +
      Number(ninos || 0) * Number(p.precio_nino || 0);

    // 6) Generar código de reserva
    const code =
      'RES-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    // 7) Insertar reserva y devolver la fila completa
    const rIns = await client.query(
      `
      INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje,
         adultos, ninos, total_usd, origen)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        code,
        p.id,
        usuarioId,            // 👈 aquí se asocia el usuario
        String(fecha),
        Number(adultos || 0),
        Number(ninos || 0),
        total,
        String(origen)
      ]
    );

    const reserva = rIns.rows[0];

    // 8) Actualizar cupos reservados
    await client.query(
      `
      UPDATE disponibilidad
         SET cupos_reservados = cupos_reservados + $1
       WHERE paquete_id = $2 AND fecha = $3
      `,
      [solicitados, p.id, String(fecha)]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      codigoReserva: code,
      total,
      reserva       // 👈 se usa en el controlador para la factura
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancela una reserva y devuelve los cupos a la disponibilidad.
 * Retorna { ok: true }
 */
export async function cancelarReserva(bookingId) {
  const id = String(bookingId || '').trim();
  if (!id) throw new Error('bookingId requerido');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1) Buscar reserva por código
    const rRes = await client.query(
      `
      SELECT id, codigo_reserva, paquete_id, fecha_viaje, adultos, ninos
        FROM reservas
       WHERE codigo_reserva = $1
       LIMIT 1
      `,
      [id]
    );
    const r = rRes.rows[0];
    if (!r) throw new Error('Reserva no encontrada');

    const solicitados = Number(r.adultos || 0) + Number(r.ninos || 0);

    // 2) Devolver cupos a disponibilidad
    await client.query(
      `
      UPDATE disponibilidad
         SET cupos_reservados = GREATEST(cupos_reservados - $1, 0)
       WHERE paquete_id = $2 AND fecha = $3
      `,
      [solicitados, r.paquete_id, String(r.fecha_viaje)]
    );

    // 3) Marcar reserva como CANCELADA
    await client.query(
      `
      UPDATE reservas
         SET estado = 'CANCELADA'
       WHERE id = $1
      `,
      [r.id]
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Lista reservas de un usuario con info del paquete.
 * Se usa para /api/v1/reservas/user/:id
 */
export async function getReservasPorUsuario(usuarioId) {
  const { rows } = await pool.query(
    `
    SELECT
      r.codigo_reserva,
      r.fecha_viaje,
      r.adultos,
      r.ninos,
      r.total_usd,
      COALESCE(r.estado, 'CONFIRMADA') AS estado,
      p.titulo,
      p.imagen
    FROM reservas r
    JOIN paquetes p ON r.paquete_id = p.id
    WHERE r.usuario_id = $1
    ORDER BY r.fecha_viaje DESC, r.id DESC
    `,
    [usuarioId]
  );

  return rows;
}
