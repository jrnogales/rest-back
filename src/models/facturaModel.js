// src/models/facturaModel.js
import { pool } from '../config/db.js';

function generarCodigoFactura() {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  const suf = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `FAC-${yyyy}${mm}${dd}-${suf}`;
}

/**
 * Crea una factura + detalle_factura a partir de una reserva
 * reserva = row devuelta por crearReserva()
 */
export async function crearFacturaParaReserva(reserva) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      id: reservaId,
      paquete_id,
      adultos,
      ninos,
      total_usd
    } = reserva;

    // Nombre del paquete
    const pRes = await client.query(
      'SELECT nombre FROM paquetes WHERE id = $1',
      [paquete_id]
    );
    const nombrePaquete = pRes.rows[0]?.nombre || 'Paquete';

    const codigoFactura = generarCodigoFactura();
    const subtotal = Number(total_usd || 0);
    const iva = +(subtotal * 0.15).toFixed(2);   // mismo IVA que en tu tabla
    const total = +(subtotal + iva).toFixed(2);

    const fRes = await client.query(
      `INSERT INTO facturas
         (codigo_factura, reserva_id, fecha_emision,
          subtotal, iva, total, metodo_pago, estado)
       VALUES
         ($1,$2, NOW(), $3,$4,$5,$6,$7)
       RETURNING id, codigo_factura`,
      [codigoFactura, reservaId, subtotal, iva, total, 'WEB', 'EMITIDA']
    );

    const facturaId = fRes.rows[0].id;

    const descripcion = `${nombrePaquete} - Adultos ${adultos} · Niños ${ninos}`;
    const cantidad = (Number(adultos || 0) + Number(ninos || 0)) || 1;
    const precioUnitario = subtotal / cantidad;

    await client.query(
      `INSERT INTO detalle_factura
         (factura_id, descripcion, cantidad, precio_unitario, total_linea)
       VALUES
         ($1,$2,$3,$4,$5)`,
      [facturaId, descripcion, cantidad, precioUnitario, subtotal]
    );

    await client.query('COMMIT');

    return {
      id: facturaId,
      codigoFactura,
      subtotal,
      iva,
      total
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
