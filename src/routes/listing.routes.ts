import { Router } from "express";
import { ListingController } from "../controllers/listing.controller";
import { ReviewController } from "../controllers/review.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/", ListingController.getListings);
router.get("/:id", ListingController.getListingById);

router.post(
  "/",
  authenticateToken,
  requireRole(["USER", "ADMIN", "EDITOR"]),
  ListingController.createListing
);

router.put(
  "/:id/status",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR", "USER"]),
  ListingController.updateListingStatus
);

router.put(
  "/:id",
  authenticateToken,
  requireRole(["ADMIN", "EDITOR", "USER"]),
  ListingController.updateListing
);

router.delete(
  "/:id",
  authenticateToken,
  ListingController.deleteListing
);

// Review route on listing
router.post(
  "/:id/reviews",
  authenticateToken,
  requireRole(["USER", "ADMIN", "EDITOR"]),
  ReviewController.createListingReview
);

export default router;
