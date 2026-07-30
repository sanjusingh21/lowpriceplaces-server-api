import { Router } from "express";
import { ServiceController } from "../controllers/service.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/", ServiceController.getServices);
router.get("/:id", ServiceController.getServiceById);

router.post(
  "/",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  ServiceController.createService
);

router.put(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  ServiceController.updateService
);

router.delete(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  ServiceController.deleteService
);

router.post("/:id/reviews", authenticateToken, ServiceController.addServiceReview);

export default router;
