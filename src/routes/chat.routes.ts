import { Router } from "express";
import { InquiryController } from "../controllers/inquiry.controller";
import { authenticateToken } from "../middlewares/auth";

const router = Router();

router.post("/start", authenticateToken, InquiryController.startChat);
router.get("/all", authenticateToken, InquiryController.getAllChats);

export default router;
