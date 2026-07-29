import { Router } from "express";
import { InquiryController } from "../controllers/inquiry.controller";
import { authenticateToken, requireRole } from "../middlewares/auth";

const router = Router();

// Inquiry Endpoints
router.post(
  "/",
  authenticateToken,
  requireRole(["USER", "ADMIN"]),
  InquiryController.sendInquiry
);

router.get(
  "/seller",
  authenticateToken,
  requireRole(["USER", "ADMIN"]),
  InquiryController.getSellerInquiries
);

router.get(
  "/buyer",
  authenticateToken,
  requireRole(["USER", "ADMIN"]),
  InquiryController.getBuyerInquiries
);

router.post("/:id/message", authenticateToken, InquiryController.sendMessage);
router.get("/:id/messages", authenticateToken, InquiryController.getInquiryMessages);
router.post("/:id/messages", authenticateToken, InquiryController.sendMessage);
router.post("/:id/read", authenticateToken, InquiryController.markAsRead);

export default router;
