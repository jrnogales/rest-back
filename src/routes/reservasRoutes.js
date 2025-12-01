// src/routes/reservasRoutes.js
import express from "express";
import { listarPorUsuario } from "../controllers/reservasController.js";

const router = express.Router();

// GET /api/v1/reservas/user/:id
router.get("/user/:id", listarPorUsuario);

export default router;
