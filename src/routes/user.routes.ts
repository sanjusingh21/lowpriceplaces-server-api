import { Router } from "express";
import { AdminController } from "../controllers/admin.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

router.get(
  "/",
  authenticateToken,
  requireRole(["ADMIN"]),
  AdminController.getUsers
);

router.post(
  "/",
  authenticateToken,
  requireRole(["ADMIN"]),
  AdminController.createUser
);

router.put(
  "/:id/role",
  authenticateToken,
  requireRole(["ADMIN"]),
  AdminController.updateUserRole
);

router.put(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN"]),
  AdminController.updateUser
);

router.delete(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN"]),
  AdminController.deleteUser
);

export default router;
