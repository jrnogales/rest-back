// src/models/facturaModel.js
import { pool } from '../config/db.js';

/**
 * Crea o actualiza una factura para UNA reserva.
 *
 * Si viene reservaInfo.loteId ⇒ se intenta reutilizar la misma factura
 * usando ese código como codigo_factura (una sola factura por carrito).
 *
 * Si NO viene loteId ⇒ se comporta como antes: una factura por reserva.
 */
export async function crearFacturaParaReserva(reservaInfo = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Buscar la reserva en la BD (por id, por código o por objeto que viene de crearReserva)
    let reservaRow;

    if (reservaInfo.reservaId) {
      // Caso: nos pasan el id numérico
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
      // Caso: nos pasan el código 'RES-...'
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

    // 2) Subtotal de ESTA reserva (sin IVA)
    const lineaSubtotal = Number(
      reservaRow.total_usd ??
      reservaInfo.total ??
      0
    );

    if (!Number.isFinite(lineaSubtotal)) {
      throw new Error('Total de reserva inválido para facturación');
    }

    // 3) Descripción para detalle_factura
    const descripcion =
      (reservaRow.titulo || 'Paquete turístico') +
      ` - Adultos ${reservaRow.adultos || 0} · Niños ${reservaRow.ninos || 0}`;

    // 4) Lógica de factura:
    //    - si viene loteId => intentamos reutilizar factura con ese codigo_factura
    //    - si no viene => generamos código único como antes
    const loteId = reservaInfo.loteId ? String(reservaInfo.loteId) : null;

    let facturaId;
    let codigoFactura;

    if (loteId) {
      // 🔗 Modo "carrito": usar un mismo codigo_factura para varias reservas
      codigoFactura = loteId;

      // 4.1 Buscar si ya existe esa factura
      const fPrev = await client.query(
        `
        SELECT id, subtotal
          FROM facturas
         WHERE codigo_factura = $1
         LIMIT 1
        `,
        [codigoFactura]
      );

      if (fPrev.rows.length > 0) {
        // ✅ Ya existe la factura del carrito → solo sumamos esta línea
        facturaId = fPrev.rows[0].id;
        const subtotalAnt = Number(fPrev.rows[0].subtotal || 0);
        const nuevoSubtotal = subtotalAnt + lineaSubtotal;
        const nuevoIva = +(nuevoSubtotal * 0.15).toFixed(2);
        const nuevoTotal = +(nuevoSubtotal + nuevoIva).toFixed(2);

        await client.query(
          `
          UPDATE facturas
             SET subtotal = $1,
                 iva      = $2,
                 total    = $3
           WHERE id = $4
          `,
          [nuevoSubtotal, nuevoIva, nuevoTotal, facturaId]
        );
      } else {
        // 🆕 Primera reserva del carrito → creamos la factura
        const iva = +(lineaSubtotal * 0.15).toFixed(2);
        const total = +(lineaSubtotal + iva).toFixed(2);

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
            codigoFactura,
            reservaRow.id,
            lineaSubtotal,
            iva,
            total,
            'WEB',
            'EMITIDA'
          ]
        );
        facturaId = facRes.rows[0].id;
      }
    } else {
      // 🧾 Modo clásico: una factura por reserva
      const iva = +(lineaSubtotal * 0.15).toFixed(2);
      const total = +(lineaSubtotal + iva).toFixed(2);

      codigoFactura =
        'FAC-' +
        new Date().toISOString().slice(0, 10).replace(/-/g, '') +
        '-' +
        Math.random().toString(36).slice(2, 6).toUpperCase(); // 18 chars máx.

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
          codigoFactura,
          reservaRow.id,
          lineaSubtotal,
          iva,
          total,
          'WEB',
          'EMITIDA'
        ]
      );
      facturaId = facRes.rows[0].id;
    }

    // 5) DETALLE (una línea para esta reserva)
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
        lineaSubtotal
      ]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      facturaId,
      codigoFactura
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
 *
 * Crea / reutiliza UNA sola factura usando un mismo loteId/codigoFactura.
 */
export async function crearFacturaParaLote(codigosReserva = []) {
  if (!Array.isArray(codigosReserva) || codigosReserva.length === 0) {
    throw new Error('Se requieren códigos de reserva para facturar el lote');
  }

  // ⚠️ MUY IMPORTANTE: que mida < 20 caracteres por la columna varchar(20)
  // FL- + AAAAMMDD + - + XXXX  => 3 + 8 + 1 + 4 = 16
  const loteId =
    'FL-' +
    new Date().toISOString().slice(0, 10).replace(/-/g, '') +
    '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  let lastResult = null;

  for (const codigoReserva of codigosReserva) {
    lastResult = await crearFacturaParaReserva({
      codigoReserva,
      loteId
    });
  }

  // lastResult lleva facturaId y codigoFactura (que será = loteId)
  return lastResult;
}
