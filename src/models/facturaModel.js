// src/models/facturaModel.js
import { pool } from '../config/db.js';

/**
 * Factura para UNA sola reserva
 */
export async function crearFacturaParaReserva(reservaInfo = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Buscar la reserva en la BD (por id o por código)
    let reservaRow;

    if (reservaInfo.reservaId) {
      const r = await client.query(
        `
        SELECT r.*, p.titulo
          FROM reservas r
          JOIN paquetes p ON r.paquete_id = p.id
         WHERE r.id = $1
         LIMIT 1
        `,
        [reservaInfo.reservaId]
      );
      reservaRow = r.rows[0];
    } else if (reservaInfo.codigoReserva) {
      const r = await client.query(
        `
        SELECT r.*, p.titulo
          FROM reservas r
          JOIN paquetes p ON r.paquete_id = p.id
         WHERE r.codigo_reserva = $1
         LIMIT 1
        `,
        [reservaInfo.codigoReserva]
      );
      reservaRow = r.rows[0];
    }

    if (!reservaRow) {
      throw new Error('Reserva para facturar no encontrada');
    }

    // 2) Totales
    const subtotal = Number(
      reservaRow.total_usd ??
      reservaInfo.total ??
      0
    );
    const iva = +(subtotal * 0.15).toFixed(2);  // 15%
    const total = +(subtotal + iva).toFixed(2);

    // 3) Código factura
    const codFac =
      'FAC-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    // 4) FACTURA
    const facRes = await client.query(
      `
      INSERT INTO facturas
        (codigo_factura, reserva_id, fecha_emision,
         subtotal, iva, total, metodo_pago, estado)
      VALUES
        ($1, $2, NOW(), $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        codFac,
        reservaRow.id,
        subtotal,
        iva,
        total,
        'WEB',
        'EMITIDA'
      ]
    );
    const facturaId = facRes.rows[0].id;

    // 5) DETALLE (1 línea resumen)
    const descripcion =
      (reservaRow.titulo || 'Paquete turístico') +
      ` - Adultos ${reservaRow.adultos || 0} · Niños ${reservaRow.ninos || 0}`;

    await client.query(
      `
      INSERT INTO detalle_factura
        (factura_id, descripcion, cantidad, precio_unitario)
      VALUES
        ($1, $2, $3, $4)
      `,
      [
        facturaId,
        descripcion,
        1,
        subtotal
      ]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      facturaId,
      codigoFactura: codFac
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Factura para TODO un carrito (varias reservas)
 * Recibe un arreglo de CÓDIGOS de reserva: ['RES-...', 'RES-...']
 */
export async function crearFacturaParaLote(codigosReserva = []) {
  if (!Array.isArray(codigosReserva) || codigosReserva.length === 0) {
    throw new Error('Se requieren códigos de reserva para facturar el lote');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Traer todas las reservas del lote con sus paquetes
    const { rows: reservas } = await client.query(
      `
      SELECT r.*, p.titulo
        FROM reservas r
        JOIN paquetes p ON r.paquete_id = p.id
       WHERE r.codigo_reserva = ANY($1::text[])
      `,
      [codigosReserva]
    );

    if (reservas.length === 0) {
      throw new Error('Reservas para facturar no encontradas');
    }

    // 2) Totales del carrito
    const subtotal = reservas.reduce(
      (s, r) => s + Number(r.total_usd || 0),
      0
    );
    const iva = +(subtotal * 0.15).toFixed(2);
    const total = +(subtotal + iva).toFixed(2);

    // 3) Código de factura
    const codFac =
      'FAC-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    // Tomamos la primera reserva como "principal" para el campo reserva_id
    const reservaPrincipal = reservas[0];

    // 4) FACTURA
    const facRes = await client.query(
      `
      INSERT INTO facturas
        (codigo_factura, reserva_id, fecha_emision,
         subtotal, iva, total, metodo_pago, estado)
      VALUES
        ($1, $2, NOW(), $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        codFac,
        reservaPrincipal.id,
        subtotal,
        iva,
        total,
        'WEB',
        'EMITIDA'
      ]
    );
    const facturaId = facRes.rows[0].id;

    // 5) DETALLES: una línea por cada reserva del carrito
    for (const r of reservas) {
      const desc =
        (r.titulo || 'Paquete turístico') +
        ` - Adultos ${r.adultos || 0} · Niños ${r.ninos || 0} ` +
        `(Reserva ${r.codigo_reserva})`;

      await client.query(
        `
        INSERT INTO detalle_factura
          (factura_id, descripcion, cantidad, precio_unitario)
        VALUES
          ($1, $2, $3, $4)
        `,
        [
          facturaId,
          desc,
          1,
          Number(r.total_usd || 0)
        ]
      );
    }

    await client.query('COMMIT');

    return {
      ok: true,
      facturaId,
      codigoFactura: codFac
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
