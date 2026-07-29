import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authenticateToken } from "../middlewares/auth";

const router = Router();

// Profile Endpoints
router.get("/", authenticateToken, AuthController.getProfile);
router.put("/", authenticateToken, AuthController.updateProfile);

export default router;
