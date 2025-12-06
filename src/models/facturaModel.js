// src/models/facturaModel.js
import { pool } from '../config/db.js';

/**
 * Crea una factura + detalle_factura para una reserva ya creada.
 * - reservaInfo puede traer: { reservaId, codigoReserva, total }
 * - Usa solamente las columnas que EXISTEN en tus tablas:
 *   facturas: id, codigo_factura, reserva_id, fecha_emision,
 *             subtotal, iva, total, metodo_pago, estado
 *   detalle_factura: id, factura_id, descripcion,
 *                    cantidad, precio_unitario, total_linea
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

    // 2) Calcular totales (usa total_usd de la reserva)
    const subtotal = Number(
      reservaRow.total_usd ??
      reservaInfo.total ??
      0
    );
    const iva = +(subtotal * 0.15).toFixed(2);  // 15%
    const total = +(subtotal + iva).toFixed(2);

    // 3) Generar código de factura
    const codFac =
      'FAC-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    // 4) Insertar en FACTURAS (sin columnas inventadas)
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
        'WEB',        // método de pago
        'EMITIDA'     // estado
      ]
    );
    const facturaId = facRes.rows[0].id;

    // 5) Insertar detalle_factura (una línea resumen)
    const descripcion =
      (reservaRow.titulo || 'Paquete turístico') +
      ` - Adultos ${reservaRow.adultos || 0} · Niños ${reservaRow.ninos || 0}`;

    await client.query(
      `
      INSERT INTO detalle_factura
        (factura_id, descripcion, cantidad, precio_unitario, total_linea)
      VALUES
        ($1, $2, $3, $4, $5)
      `,
      [
        facturaId,
        descripcion,
        1,          // cantidad (1 ítem resumen)
        subtotal,   // precio_unitario
        subtotal    // total_linea
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
