import { Router } from "express";
import { MediaController } from "../controllers/media.controller";
import { authenticateToken } from "../middlewares/auth";
import { validatePresignedUpload, validateUploadComplete } from "../middlewares/validation";

const router = Router();

// 1. Generate S3 PUT presigned URL for upload
router.post(
  "/presigned-upload",
  authenticateToken,
  validatePresignedUpload,
  MediaController.requestPresignedUpload
);

// 2. Confirm upload completion and save metadata
router.post(
  "/complete",
  authenticateToken,
  validateUploadComplete,
  MediaController.completeUpload
);

// 3. Get Media metadata info by ID
router.get("/:id", authenticateToken, MediaController.getMedia);

// 4. Generate S3 GET presigned URL for secure download
router.get("/:id/download", authenticateToken, MediaController.downloadMedia);

// 5. Delete media from S3 and database
router.delete("/:id", authenticateToken, MediaController.deleteMedia);

// 6. Public redirect route for viewing private media (automatically signs and redirects)
router.get("/view/*", MediaController.viewMedia);

export default router;
