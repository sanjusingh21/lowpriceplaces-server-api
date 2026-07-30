import { Router } from "express";
import { StoreController } from "../controllers/store.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

// Store Endpoints
router.get("/", StoreController.getStores);
router.get("/:id", StoreController.getStoreById);

router.post(
  "/",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  StoreController.createStore
);

router.put(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  StoreController.updateStore
);

router.delete(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR"]),
  StoreController.deleteStore
);

// Store reviews
router.post("/:id/reviews", authenticateToken, StoreController.addStoreReview);

export default router;
