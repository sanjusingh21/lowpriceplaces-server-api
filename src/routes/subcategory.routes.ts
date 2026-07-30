import { Router } from "express";
import { CategoryController } from "../controllers/category.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

router.put(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  CategoryController.updateSubcategory
);

router.delete(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  CategoryController.deleteSubcategory
);

export default router;
