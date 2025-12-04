// src/models/reservaModel.js
import { pool } from '../config/db.js';

/**
 * Crea una reserva con control de stock y disponibilidad.
 * Además genera la FACTURA + DETALLE_FACTURA.
 *
 * Retorna { ok, codigoReserva, total }  // total = subtotal sin IVA
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

    // 1) Buscar paquete
    const pRes = await client.query(
      'SELECT * FROM paquetes WHERE codigo = $1 LIMIT 1',
      [String(codigo)]
    );
    const p = pRes.rows[0];
    if (!p) throw new Error('Paquete no encontrado');

    const solicitados = Number(adultos || 0) + Number(ninos || 0);
    if (solicitados <= 0) throw new Error('Cantidad inválida');

    // 2) Asegurar fila disponibilidad (30 cupos por defecto)
    await client.query(
      `
      INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
      VALUES ($1, $2, 30, 0)
      ON CONFLICT (paquete_id, fecha) DO NOTHING
      `,
      [p.id, String(fecha)]
    );

    // 3) Leer disponibilidad bloqueando fila
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

    // 4) Total $ (SIN IVA)
    const total =
      Number(adultos || 0) * Number(p.precio_adulto || 0) +
      Number(ninos || 0) * Number(p.precio_nino || 0);

    // 5) Generar código de reserva (ej: RES-20251204-4A5F)
    const code =
      'RES-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    // 6) Insert reserva (con usuario_id) y obtener ID
    const rIns = await client.query(
      `
      INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje,
         adultos, ninos, total_usd, origen, estado, creado_en)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,'CONFIRMADA', NOW())
      RETURNING id
      `,
      [
        code,
        p.id,
        usuarioId,
        String(fecha),
        Number(adultos || 0),
        Number(ninos || 0),
        total,
        String(origen)
      ]
    );
    const reservaId = rIns.rows[0].id;

    // 7) Descontar cupos
    await client.query(
      `
      UPDATE disponibilidad
         SET cupos_reservados = cupos_reservados + $1
       WHERE paquete_id = $2 AND fecha = $3
      `,
      [solicitados, p.id, String(fecha)]
    );

    // 8) CREAR FACTURA + DETALLE_FACTURA (IVA 15%)
    const subtotal = total;
    const iva = +(subtotal * 0.15).toFixed(2);
    const totalFactura = +(subtotal + iva).toFixed(2);

    const codFactura =
      'FAC-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    // Tabla: FACTURAS
    const fRes = await client.query(
      `
      INSERT INTO facturas
        (codigo_factura, reserva_id, fecha_emision,
         subtotal, iva, total, metodo_pago, estado)
      VALUES
        ($1,$2,NOW(),$3,$4,$5,'WEB','EMITIDA')
      RETURNING id
      `,
      [codFactura, reservaId, subtotal, iva, totalFactura]
    );
    const facturaId = fRes.rows[0].id;

    // Tabla: DETALLE_FACTURA
    const descripcion =
      `${p.titulo} - Adultos ${adultos} · Niños ${ninos}`;
    await client.query(
      `
      INSERT INTO detalle_factura
        (factura_id, descripcion, cantidad, precio_unitario, total_linea)
      VALUES
        ($1,$2,$3,$4,$5)
      `,
      [facturaId, descripcion, solicitados || 1, subtotal / (solicitados || 1), subtotal]
    );

    // 9) Commit
    await client.query('COMMIT');

    // total = subtotal (sin IVA), igual que antes para no romper el FRONT
    return { ok: true, codigoReserva: code, total };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
