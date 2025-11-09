import { pool } from '../config/db.js';

export async function crearReserva({ codigo, fecha, adultos, ninos, origen='REST' }){
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pRes = await client.query('SELECT * FROM paquetes WHERE codigo= LIMIT 1', [codigo]);
    const p = pRes.rows[0];
    if(!p) throw new Error('Paquete no encontrado');

    const solicitados = Number(adultos||0) + Number(ninos||0);

    await client.query(
      INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
       VALUES (,,30,0)
       ON CONFLICT (paquete_id, fecha) DO NOTHING,
      [p.id, fecha]
    );

    const { rows } = await client.query(
      SELECT id, cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id= AND fecha=
        FOR UPDATE,
      [p.id, fecha]
    );
    if(!rows.length) throw new Error('No hay disponibilidad');

    const d = rows[0];
    const disponibles = Number(d.cupos_totales) - Number(d.cupos_reservados);
    if(disponibles < solicitados) throw new Error(\Stock insuficiente (\)\);

    const total =
      (Number(adultos||0)*Number(p.precio_adulto||0)) +
      (Number(ninos||0)*Number(p.precio_nino||0));

    const code = 'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'')
              + '-' + Math.random().toString(36).slice(2,6).toUpperCase();

    await client.query(
      INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
       VALUES (,,,,,,,),
      [code, p.id, null, fecha, adultos, ninos, total, origen]
    );

    await client.query(
      UPDATE disponibilidad
          SET cupos_reservados = cupos_reservados + 
        WHERE paquete_id= AND fecha=,
      [solicitados, p.id, fecha]
    );

    await client.query('COMMIT');
    return { codigoReserva: code, total };
  } catch (e){
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelarReserva(codigo){
  await pool.query('SELECT cancelar_reserva()', [codigo]);
}
