// src/models/facturaModel.js
import { pools } from '../config/db.js';

const poolFacturas = pools.facturas;
const poolReservas = pools.reservas;

async function getReservaParaFacturar({ reservaId, codigoReserva }) {
  if (reservaId) {
    const { rows } = await poolReservas.query(`SELECT * FROM reservas WHERE id=$1 LIMIT 1`, [Number(reservaId)]);
    return rows[0] || null;
  }
  if (codigoReserva) {
    const { rows } = await poolReservas.query(`SELECT * FROM reservas WHERE codigo_reserva=$1 LIMIT 1`, [String(codigoReserva)]);
    return rows[0] || null;
  }
  return null;
}

export async function crearFacturaParaReserva(reservaInfo = {}) {
  const client = await poolFacturas.connect();
  try {
    await client.query('BEGIN');

    const reservaRow = await getReservaParaFacturar({
      reservaId: reservaInfo.reservaId,
      codigoReserva: reservaInfo.codigoReserva || reservaInfo.codigoReserva
    });

    if (!reservaRow) throw new Error('Reserva para facturar no encontrada');

    const lineaSubtotal = Number(reservaRow.total_usd ?? reservaInfo.total ?? 0);
    if (!Number.isFinite(lineaSubtotal)) throw new Error('Total de reserva inválido para facturación');

    const descripcion =
      (reservaRow.paquete_titulo || 'Paquete turístico') +
      ` - Adultos ${reservaRow.adultos || 0} · Niños ${reservaRow.ninos || 0}`;

    const loteId = reservaInfo.loteId ? String(reservaInfo.loteId) : null;

    let facturaId;
    let codigoFactura;

    if (loteId) {
      codigoFactura = loteId;

      const fPrev = await client.query(
        `SELECT id, subtotal FROM facturas WHERE codigo_factura=$1 LIMIT 1`,
        [codigoFactura]
      );

      if (fPrev.rows.length) {
        facturaId = fPrev.rows[0].id;
        const subtotalAnt = Number(fPrev.rows[0].subtotal || 0);
        const nuevoSubtotal = subtotalAnt + lineaSubtotal;
        const nuevoIva = +(nuevoSubtotal * 0.15).toFixed(2);
        const nuevoTotal = +(nuevoSubtotal + nuevoIva).toFixed(2);

        await client.query(
          `UPDATE facturas SET subtotal=$1, iva=$2, total=$3 WHERE id=$4`,
          [nuevoSubtotal, nuevoIva, nuevoTotal, facturaId]
        );
      } else {
        const iva = +(lineaSubtotal * 0.15).toFixed(2);
        const total = +(lineaSubtotal + iva).toFixed(2);

        const facRes = await client.query(
          `
          INSERT INTO facturas
            (codigo_factura, reserva_id, fecha_emision, subtotal, iva, total, metodo_pago, estado)
          VALUES ($1,$2,NOW(),$3,$4,$5,'WEB','EMITIDA')
          RETURNING id
          `,
          [codigoFactura, reservaRow.id, lineaSubtotal, iva, total]
        );
        facturaId = facRes.rows[0].id;
      }
    } else {
      const iva = +(lineaSubtotal * 0.15).toFixed(2);
      const total = +(lineaSubtotal + iva).toFixed(2);

      codigoFactura =
        'FAC-' +
        new Date().toISOString().slice(0, 10).replace(/-/g, '') +
        '-' +
        Math.random().toString(36).slice(2, 6).toUpperCase();

      const facRes = await client.query(
        `
        INSERT INTO facturas
          (codigo_factura, reserva_id, fecha_emision, subtotal, iva, total, metodo_pago, estado)
        VALUES ($1,$2,NOW(),$3,$4,$5,'WEB','EMITIDA')
        RETURNING id
        `,
        [codigoFactura, reservaRow.id, lineaSubtotal, iva, total]
      );
      facturaId = facRes.rows[0].id;
    }

    // Detalle (incluye total_linea para que tu admin lo muestre bien)
    await client.query(
  `
  INSERT INTO detalle_factura
    (factura_id, descripcion, cantidad, precio_unitario)
  VALUES ($1,$2,$3,$4)
  `,
  [facturaId, descripcion, 1, lineaSubtotal]
);


    await client.query('COMMIT');
    return { ok: true, facturaId, codigoFactura };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function crearFacturaParaLote(codigosReserva = []) {
  if (!Array.isArray(codigosReserva) || codigosReserva.length === 0) {
    throw new Error('Se requieren códigos de reserva para facturar el lote');
  }

  const loteId =
    'FL-' +
    new Date().toISOString().slice(0, 10).replace(/-/g, '') +
    '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  let lastResult = null;
  for (const codigoReserva of codigosReserva) {
    lastResult = await crearFacturaParaReserva({ codigoReserva, loteId });
  }
  return lastResult;
}

// Admin: listar facturas base
export async function listarFacturasDB() {
  const { rows } = await poolFacturas.query(
    `
    SELECT id, codigo_factura, fecha_emision, subtotal, iva, total, metodo_pago, estado, reserva_id
    FROM facturas
    ORDER BY fecha_emision DESC, id DESC
    `
  );
  return rows;
}

export async function getFacturaPorIdDB(id) {
  const { rows } = await poolFacturas.query(
    `
    SELECT id, codigo_factura, fecha_emision, subtotal, iva, total, metodo_pago, estado, reserva_id
    FROM facturas
    WHERE id=$1
    LIMIT 1
    `,
    [Number(id)]
  );
  return rows[0] || null;
}

export async function getDetalleFacturaDB(facturaId) {
  const { rows } = await poolFacturas.query(
    `
    SELECT id, descripcion, cantidad, precio_unitario, total_linea
    FROM detalle_factura
    WHERE factura_id=$1
    ORDER BY id
    `,
    [Number(facturaId)]
  );
  return rows;
}

export async function getFacturaByReservaId(reservaId) {
  const { rows } = await poolFacturas.query(
    `
    SELECT id, codigo_factura, total, estado
    FROM facturas
    WHERE reserva_id=$1
    ORDER BY fecha_emision DESC
    LIMIT 1
    `,
    [Number(reservaId)]
  );
  return rows[0] || null;
}

export async function anularFactura(idFactura) {
  await poolFacturas.query(`UPDATE facturas SET estado='ANULADA' WHERE id=$1`, [Number(idFactura)]);
  return true;
}
