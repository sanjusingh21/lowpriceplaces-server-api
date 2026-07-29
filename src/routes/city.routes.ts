import { Router } from "express";
import { CityController } from "../controllers/city.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/", CityController.getCities);

router.post(
  "/",
  authenticateToken,
  requireRole(["ADMIN"]),
  CityController.createCity
);

router.put(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN"]),
  CityController.updateCity
);

router.delete(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN"]),
  CityController.deleteCity
);

export default router;
