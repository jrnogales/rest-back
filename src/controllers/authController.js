// src/controllers/authController.js
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { findUserByEmail, createUser, findUserById } from '../models/usuarioModel.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // ✅ Render = true
  sameSite: 'lax',
  maxAge: 1000 * 60 * 60 * 24 * 7
};


export async function login(req, res) {
  try {
    const { email, password } = req.body;

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ ok: false, error: 'Correo o contraseña incorrectos' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ ok: false, error: 'Correo o contraseña incorrectos' });
    }

    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, COOKIE_OPTIONS);

    return res.json({
      ok: true,
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export async function register(req, res) {
  try {
    const { nombre, apellido, email, telefono, cedula, password } = req.body;

    const exists = await findUserByEmail(email);
    if (exists) {
      return res.status(400).json({ ok: false, error: 'El correo ya está registrado' });
    }

    const user = await createUser({
      nombre,
      apellido,
      email,
      telefono,
      cedula,
      password
    });

    return res.json({ ok: true, user });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export async function me(req, res) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.json({ ok: false, user: null });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await findUserById(decoded.id);

    return res.json({ ok: true, user });
  } catch {
    return res.json({ ok: false, user: null });
  }
}

export function logout(req, res) {
  res.clearCookie('token');
  res.json({ ok: true });
}
