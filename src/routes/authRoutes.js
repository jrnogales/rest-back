// src/routes/authRoutes.js
import express from 'express';
import { login, register, me, logout } from '../controllers/authController.js';

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.get('/me', me);
router.post('/logout', logout);

export default router;
