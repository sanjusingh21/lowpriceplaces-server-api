import { Router } from "express";
import { SeoController } from "../controllers/seo.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/", SeoController.getSeo);
router.post(
  "/",
  authenticateToken,
  requireRole(["SEO", "ADMIN"]),
  SeoController.updateSeo
);

export default router;
