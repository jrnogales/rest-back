// src/controllers/paquetesIntegracionController.js
import { pool } from '../config/db.js';

/* ================== Utils ================== */

function brief(txt = '', len = 140) {
  const s = String(txt).replace(/\s+/g, ' ').trim();
  return s.length <= len ? s : s.slice(0, len - 1) + '…';
}

function buildPaqueteRow(p) {
  return {
    id_paquete: p.codigo,
    ciudad: 'Cuenca',
    pais: 'Ecuador',
    tipo_actividad: 'Paquete turístico',
    capacidad: Number(p.stock || 30),
    precio_normal: Number(p.precicio_adulto || p.precio_adulto || 0),
    precio_actual: Number(p.precio_adulto || 0),
    uri_imagen: p.imagen || '',
    descripcion: brief(p.descripcion || ''),
    duracion: Number(p.duracion_dias || 1),
    currency: p.currency || 'USD'
  };
}

// Holds de pre-reserva en memoria
const holds = new Map();

/* ============================================================
   1) GET /api/v2/paquetes
      -> buscarPaquetes()
   ============================================================ */
export async function buscarPaquetes(req, res) {
  const client = await pool.connect();
  try {
    const { precio_min, precio_max } = req.query;

    const { rows } = await client.query(
      'SELECT * FROM paquetes ORDER BY id ASC'
    );

    let lista = rows.map(buildPaqueteRow);

    const minP = precio_min != null ? Number(precio_min) : null;
    const maxP = precio_max != null ? Number(precio_max) : null;

    if (minP != null) lista = lista.filter(p => p.precio_actual >= minP);
    if (maxP != null) lista = lista.filter(p => p.precio_actual <= maxP);

    return res.json(lista);
  } catch (err) {
    console.error('buscarPaquetes:', err);
    return res.status(500).json({ error: 'Error al buscar paquetes' });
  } finally {
    client.release();
  }
}

/* ============================================================
   2) POST /api/v2/paquetes/availability
      body: { idPaquete, fechaInicio, personas }
      -> validarDisponibilidadPaquete()
   ============================================================ */
export async function validarDisponibilidadPaquete(req, res) {
  const client = await pool.connect();
  try {
    const { idPaquete, fechaInicio, personas } = req.body || {};

    const codigo = String(idPaquete || '').trim();
    const fecha = String(fechaInicio || '').slice(0, 10);
    const num = Math.max(0, parseInt(personas || '0', 10));

    if (!codigo || !fecha || !num) {
      return res
        .status(400)
        .json({ disponible: false, mensaje: 'Datos incompletos' });
    }

    const pRes = await client.query(
      'SELECT id FROM paquetes WHERE codigo = $1 LIMIT 1',
      [codigo]
    );
    const p = pRes.rows[0];
    if (!p) {
      return res
        .status(404)
        .json({ disponible: false, mensaje: 'Paquete no encontrado' });
    }

    // Aseguramos fila
    await client.query(
      `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
       VALUES ($1,$2,30,0)
       ON CONFLICT (paquete_id, fecha) DO NOTHING`,
      [p.id, fecha]
    );

    const dRes = await client.query(
      `SELECT cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id=$1 AND fecha=$2`,
      [p.id, fecha]
    );

    if (!dRes.rows.length) {
      return res.json({
        disponible: false,
        mensaje: 'Sin registro de disponibilidad'
      });
    }

    const disp =
      dRes.rows[0].cupos_totales - dRes.rows[0].cupos_reservados;
    const disponible = disp >= num;

    return res.json({
      disponible,
      cupos_disponibles: disp
    });
  } catch (err) {
    console.error('validarDisponibilidadPaquete:', err);
    return res
      .status(500)
      .json({ disponible: false, mensaje: 'Error interno' });
  } finally {
    client.release();
  }
}

/* ============================================================
   3) POST /api/v2/paquetes/pre-reserva
      body: { id_paquete, fecha_inicio, turistas[], duracionHoldSegundos? }
      -> crearPreReservaPaquete()
   ============================================================ */
export async function crearPreReservaPaquete(req, res) {
  try {
    const {
      id_paquete,
      fecha_inicio,
      turistas = [],
      duracionHoldSegundos
    } = req.body || {};

    const codigo = String(id_paquete || '').trim();
    const fecha = String(fecha_inicio || '').slice(0, 10);

    if (!codigo || !fecha) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const holdId =
      'HOLD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const seg = Math.max(60, parseInt(duracionHoldSegundos || '600', 10));
    const expiraEn = new Date(Date.now() + seg * 1000).toISOString();

    holds.set(holdId, {
      id_paquete: codigo,
      fecha_inicio: fecha,
      turistas,
      expiraEn
    });

    return res.json({ id_hold: holdId, expiraEn });
  } catch (err) {
    console.error('crearPreReservaPaquete:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

/* ============================================================
   4) POST /api/v2/paquetes/reserva
      body: { id_paquete, id_hold, correo, turistas[] }
      -> reservarPaquete()
   ============================================================ */
export async function reservarPaquete(req, res) {
  const client = await pool.connect();
  try {
    const { id_paquete, id_hold, correo, turistas = [] } = req.body || {};

    const codigo = String(id_paquete || '').trim();
    const holdId = String(id_hold || '').trim();
    const email = String(correo || '').trim();

    if (!codigo || !holdId || !email) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const hold = holds.get(holdId);
    if (!hold || hold.id_paquete !== codigo) {
      return res.status(400).json({ error: 'Hold inválido' });
    }
    if (hold.expiraEn && new Date(hold.expiraEn) < new Date()) {
      holds.delete(holdId);
      return res.status(400).json({ error: 'Hold expirado' });
    }

    const fecha = hold.fecha_inicio;
    const adultos =
      turistas.filter(t => t.tipo === 'adulto' || !t.tipo).length || 1;
    const ninos = turistas.filter(t => t.tipo === 'nino').length || 0;
    const solicitados = adultos + ninos;

    await client.query('BEGIN');

    const pRes = await client.query(
      'SELECT * FROM paquetes WHERE codigo=$1 LIMIT 1',
      [codigo]
    );
    const p = pRes.rows[0];
    if (!p) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paquete no encontrado' });
    }

    // Aseguramos fila de disponibilidad
    await client.query(
      `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
       VALUES ($1,$2,30,0)
       ON CONFLICT (paquete_id, fecha) DO NOTHING`,
      [p.id, fecha]
    );

    const dRes = await client.query(
      `SELECT cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id=$1 AND fecha=$2
        FOR UPDATE`,
      [p.id, fecha]
    );
    if (!dRes.rows.length) {
      await client.query('ROLLBACK');
      return res
        .status(400)
        .json({ error: 'No hay disponibilidad para esa fecha' });
    }

    const disp =
      dRes.rows[0].cupos_totales - dRes.rows[0].cupos_reservados;
    if (disp < solicitados) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Stock insuficiente. Quedan ${disp} cupos`
      });
    }

    // Usuario por correo (crea si no existe)
    let uRes = await client.query(
      'SELECT id FROM usuarios WHERE email=$1 LIMIT 1',
      [email]
    );
    let usuarioId;
    if (uRes.rows.length) {
      usuarioId = uRes.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO usuarios (nombre, email, rol, estado, creado_en)
         VALUES ($1,$2,'user','activo',NOW())
         RETURNING id`,
        [email, email]
      );
      usuarioId = ins.rows[0].id;
    }

    const total =
      adultos * Number(p.precio_adulto || 0) +
      ninos * Number(p.precio_nino || 0);

    const codReserva =
      'RES-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const rIns = await client.query(
      `INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje,
         adultos, ninos, total_usd, origen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'REST')
       RETURNING id`,
      [codReserva, p.id, usuarioId, fecha, adultos, ninos, total]
    );

    await client.query(
      `UPDATE disponibilidad
          SET cupos_reservados = cupos_reservados + $1
        WHERE paquete_id=$2 AND fecha=$3`,
      [solicitados, p.id, fecha]
    );

    await client.query('COMMIT');
    holds.delete(holdId);

    return res.json({
      id_reserva: codReserva,
      reserva_id_interno: rIns.rows[0].id
    });
  } catch (err) {
    console.error('reservarPaquete:', err);
    try {
      await client.query('ROLLBACK');
    } catch {}
    return res.status(500).json({ error: 'Error interno' });
  } finally {
    client.release();
  }
}

/* ============================================================
   5) POST /api/v2/paquetes/usuarios/externo
      body: { bookingUserId?, nombre, apellido?, correo }
      -> crearUsuarioExterno()
   ============================================================ */
export async function crearUsuarioExterno(req, res) {
  const client = await pool.connect();
  try {
    const { bookingUserId, nombre, apellido, correo } = req.body || {};
    const email = String(correo || '').trim();
    const first = String(nombre || '').trim();
    const last = apellido != null ? String(apellido).trim() : null;

    if (!email || !first) {
      return res
        .status(400)
        .json({ error: 'correo y nombre son obligatorios' });
    }

    await client.query('BEGIN');

    let uRes;
    if (bookingUserId) {
      uRes = await client.query(
        `SELECT id, email
           FROM usuarios
          WHERE id::text = $1 OR email = $2
          LIMIT 1`,
        [String(bookingUserId), email]
      );
    } else {
      uRes = await client.query(
        `SELECT id, email
           FROM usuarios
          WHERE email = $1
          LIMIT 1`,
        [email]
      );
    }

    let userRow;
    if (uRes.rows.length) {
      userRow = uRes.rows[0];
      await client.query(
        `UPDATE usuarios
            SET nombre=$1,
                apellido=COALESCE($2, apellido)
          WHERE id=$3`,
        [first, last, userRow.id]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO usuarios (nombre, apellido, email, rol, estado, creado_en)
         VALUES ($1,$2,$3,'user','activo',NOW())
         RETURNING id, email`,
        [first, last, email]
      );
      userRow = ins.rows[0];
    }

    await client.query('COMMIT');

    return res.json({
      id_usuario: userRow.id,
      correo: userRow.email
    });
  } catch (err) {
    console.error('crearUsuarioExterno:', err);
    try {
      await client.query('ROLLBACK');
    } catch {}
    return res.status(500).json({ error: 'Error interno' });
  } finally {
    client.release();
  }
}

/* ============================================================
   6) POST /api/v2/paquetes/invoices
      body: { id_reserva, correo, nombre, valor_pagado, id_transaccion, ... }
      -> emitirFacturaPaquete()
   ============================================================ */
export async function emitirFacturaPaquete(req, res) {
  const client = await pool.connect();
  try {
    const {
      id_reserva,
      correo,
      nombre,
      valor_pagado,
      id_transaccion
    } = req.body || {};

    if (!id_reserva || !correo || !nombre || !valor_pagado) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    await client.query('BEGIN');

    const rRes = await client.query(
      `SELECT r.id, r.total_usd, r.codigo_reserva,
              p.titulo, r.adultos, r.ninos
         FROM reservas r
         JOIN paquetes p ON p.id = r.paquete_id
        WHERE r.codigo_reserva = $1
        LIMIT 1`,
      [String(id_reserva)]
    );
    const r = rRes.rows[0];
    if (!r) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const total = Number(valor_pagado || r.total_usd || 0);
    const iva = +(total * 0.15).toFixed(2);
    const subtotal = +(total - iva).toFixed(2);

    const codFactura =
      'FAC-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const fIns = await client.query(
      `INSERT INTO facturas
        (codigo_factura, reserva_id, fecha_emision,
         subtotal, iva, total, metodo_pago, estado)
       VALUES ($1,$2,NOW(),$3,$4,$5,'WEB','EMITIDA')
       RETURNING id, codigo_factura`,
      [codFactura, r.id, subtotal, iva, total]
    );
    const factura = fIns.rows[0];

    const descripcion = `${r.titulo} - Adultos ${r.adultos}, Niños ${r.ninos}`;
    await client.query(
      `INSERT INTO detalle_factura
        (factura_id, descripcion, cantidad, precio_unitario, total_linea)
       VALUES ($1,$2,1,$3,$4)`,
      [factura.id, descripcion, total, total]
    );

    await client.query('COMMIT');

    // URL “lógica” para que el booking la pueda mostrar si quiere
    const uri_factura = `https://backend-cuenca.onrender.com/admin/facturas/${factura.codigo_factura}`;

    return res.json({
      url_factura: uri_factura
    });
  } catch (err) {
    console.error('emitirFacturaPaquete:', err);
    try {
      await client.query('ROLLBACK');
    } catch {}
    return res.status(500).json({ error: 'Error interno' });
  } finally {
    client.release();
  }
}

/* ============================================================
   7) GET /api/v2/paquetes/:id/reserva
      -> buscarDatosReserva()
   ============================================================ */
export async function buscarDatosReserva(req, res) {
  const client = await pool.connect();
  try {
    const idReserva = String(req.params.id || '').trim();
    if (!idReserva) {
      return res.status(400).json({ error: 'id de reserva requerido' });
    }

    const rRes = await client.query(
      `SELECT r.id, r.codigo_reserva, r.fecha_viaje,
              r.adultos, r.ninos, r.total_usd,
              p.codigo AS codigo_paquete,
              p.titulo,
              u.email
         FROM reservas r
         JOIN paquetes p ON p.id = r.paquete_id
         LEFT JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.codigo_reserva = $1
        LIMIT 1`,
      [idReserva]
    );
    const r = rRes.rows[0];
    if (!r) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    const fRes = await client.query(
      `SELECT codigo_factura
         FROM facturas
        WHERE reserva_id = $1
        ORDER BY fecha_emision DESC
        LIMIT 1`,
      [r.id]
    );
    const f = fRes.rows[0];
    const uri_factura = f
      ? `https://backend-cuenca.onrender.com/admin/facturas/${f.codigo_factura}`
      : null;

    return res.json({
      id_paquete: r.codigo_paquete,
      correo: r.email,
      fecha_inicio: r.fecha_viaje,
      duracion: 1,
      tipo_actividad: 'Paquete turístico',
      turistas: {
        adultos: r.adultos,
        ninos: r.ninos
      },
      valor_pagado: r.total_usd,
      uri_factura
    });
  } catch (err) {
    console.error('buscarDatosReserva:', err);
    return res.status(500).json({ error: 'Error interno' });
  } finally {
    client.release();
  }
}

/* ============================================================
   8) POST /api/v2/paquetes/cancelar
      body: { id_reserva }
      -> cancelarReservaPaquete()
   ============================================================ */
export async function cancelarReservaPaquete(req, res) {
  const client = await pool.connect();
  try {
    const { id_reserva } = req.body || {};
    const codigo = String(id_reserva || "").trim();

    if (!codigo) {
      return res
        .status(400)
        .json({ exito: false, mensaje: "id_reserva es obligatorio" });
    }

    await client.query("BEGIN");

    // Buscamos por código de reserva (RES-...) o por id numérico
    const rRes = await client.query(
      `SELECT r.id,
              r.codigo_reserva,
              r.fecha_viaje,
              r.adultos,
              r.ninos,
              r.total_usd,
              r.paquete_id,
              r.estado
         FROM reservas r
        WHERE r.codigo_reserva = $1
           OR r.id::text       = $1
        LIMIT 1`,
      [codigo]
    );

    if (!rRes.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ exito: false, mensaje: "Reserva no encontrada" });
    }

    const r = rRes.rows[0];

    // Si ya estaba cancelada, no hacemos nada de stock
    if (r.estado === "CANCELADA") {
      await client.query("ROLLBACK");
      return res.json({
        exito: false,
        valor_pagado: Number(r.total_usd || 0),
        mensaje: "La reserva ya estaba cancelada",
      });
    }

    const cupos = Number(r.adultos || 0) + Number(r.ninos || 0);

    // Devolvemos cupos en disponibilidad
    await client.query(
      `UPDATE disponibilidad
          SET cupos_reservados = GREATEST(cupos_reservados - $1, 0)
        WHERE paquete_id = $2
          AND fecha       = $3`,
      [cupos, r.paquete_id, r.fecha_viaje]
    );

    // Marcamos la reserva como CANCELADA
    await client.query(
      `UPDATE reservas
          SET estado = 'CANCELADA'
        WHERE id = $1`,
      [r.id]
    );

    await client.query("COMMIT");

    // Lo que el Booking Bus necesita
    return res.json({
      exito: true,
      valor_pagado: Number(r.total_usd || 0),
    });
  } catch (err) {
    console.error("cancelarReservaPaquete:", err);
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res
      .status(500)
      .json({ exito: false, mensaje: "Error interno al cancelar" });
  } finally {
    client.release();
  }
}

