import { Router } from "express";
import { AdminController } from "../controllers/admin.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

router.get(
  "/user-profiles",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  AdminController.getSellerProfiles
);

router.delete(
  "/user-profiles/:id",
  authenticateToken,
  requireRole(["ADMIN"]),
  AdminController.deleteSellerProfile
);

export default router;
