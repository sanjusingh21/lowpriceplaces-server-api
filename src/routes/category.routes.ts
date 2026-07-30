import { Router } from "express";
import { CategoryController } from "../controllers/category.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

// Public Category Endpoints
router.get("/", CategoryController.getCategories);

// Category Admin/Editor Operations
router.post(
  "/",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  CategoryController.createCategory
);
router.put(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  CategoryController.updateCategory
);
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  CategoryController.deleteCategory
);

// Subcategory Operations
router.post(
  "/:categoryId/subcategories",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  CategoryController.createSubcategory
);

export default router;
