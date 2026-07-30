import { Router } from "express";
import { ReviewController } from "../controllers/review.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

// Delete review
router.delete("/:id", authenticateToken, ReviewController.deleteReview);

export default router;
