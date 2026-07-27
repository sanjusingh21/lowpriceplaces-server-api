import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { S3Service } from "../services/s3.service";
import { MediaModel } from "../models/media.model";
import { bucketName } from "../config/aws";

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    role: string;
  };
}

export class MediaController {
  /**
   * Request a presigned S3 upload URL (PUT method)
   */
  static async requestPresignedUpload(req: AuthenticatedRequest, res: Response) {
    try {
      const { folder, fileName, contentType } = req.body;
      const lastDot = fileName.lastIndexOf(".");
      const extension = fileName.substring(lastDot).toLowerCase();
      
      // Generate clean secure UUID filename
      const uniqueName = `${uuidv4()}${extension}`;
      const cleanFolder = folder.endsWith("/") ? folder.slice(0, -1) : folder;
      const key = `${cleanFolder}/${uniqueName}`;

      // Generate Putnam presigned URL (expires in 5 minutes)
      const uploadUrl = await S3Service.getPresignedPutUrl(key, contentType);
      const publicUrl = `https://${bucketName}.s3.amazonaws.com/${key}`;

      return res.status(200).json({
        uploadUrl,
        key,
        publicUrl
      });
    } catch (error: any) {
      console.error("Presigned upload request error:", error);
      return res.status(500).json({ error: "Failed to generate presigned upload URL: " + error.message });
    }
  }

  /**
   * Confirm S3 upload has completed and store metadata
   */
  static async completeUpload(req: AuthenticatedRequest, res: Response) {
    try {
      const { key, type, size } = req.body;

      // Extract details from S3 key (e.g. users/23/profile/filename.jpg)
      const parts = key.split("/");
      const lastDot = key.lastIndexOf(".");
      const extension = lastDot !== -1 ? key.substring(lastDot).toLowerCase() : "";
      
      let uploadedBy = req.user?.id || null;
      let entityType = null;
      let entityId = null;

      // Parse folder pattern to associate entity automatically if matches standard structure
      if (parts.length >= 3) {
        if (parts[0] === "users") {
          const userIdVal = parseInt(parts[1], 10);
          if (!isNaN(userIdVal)) {
            uploadedBy = userIdVal;
            entityType = parts[2].toUpperCase(); // PROFILE or GALLERY
            entityId = userIdVal;
          }
        } else if (parts[0] === "posts" || parts[0] === "products") {
          entityType = parts[0].slice(0, -1).toUpperCase(); // POST or PRODUCT
          const entityIdVal = parseInt(parts[1], 10);
          if (!isNaN(entityIdVal)) {
            entityId = entityIdVal;
          }
        }
      } else if (parts.length >= 2 && (parts[0] === "admin" || parts[0] === "temp")) {
        entityType = parts[0].toUpperCase(); // ADMIN or TEMP
      }

      const protocol = req.protocol;
      const host = req.get('host');
      const url = `${protocol}://${host}/api/media/view/${key}`;

      const media = await MediaModel.create({
        key,
        url,
        mimeType: type,
        size,
        extension,
        uploadedBy: uploadedBy || undefined,
        entityType: entityType || undefined,
        entityId: entityId || undefined
      });

      return res.status(201).json(media);
    } catch (error: any) {
      console.error("Upload completion error:", error);
      return res.status(500).json({ error: "Failed to save media metadata: " + error.message });
    }
  }

  /**
   * Automatically sign and redirect to the S3 URL for viewing private media in browsers
   */
  static async viewMedia(req: Request, res: Response) {
    try {
      const key = req.params[0];
      if (!key) {
        return res.status(400).json({ error: "Missing file key path." });
      }

      const downloadUrl = await S3Service.getPresignedGetUrl(key);
      return res.redirect(downloadUrl);
    } catch (error: any) {
      console.error("View media redirection error:", error);
      return res.status(404).json({ error: "File not found: " + error.message });
    }
  }

  /**
   * Get media information by ID
   */
  static async getMedia(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const media = await MediaModel.findById(id);
      
      if (!media) {
        return res.status(404).json({ error: "Media resource not found." });
      }

      return res.status(200).json(media);
    } catch (error: any) {
      console.error("Get media error:", error);
      return res.status(500).json({ error: "Failed to retrieve media information: " + error.message });
    }
  }

  /**
   * Generate download pre-signed URL for private media
   */
  static async downloadMedia(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const media = await MediaModel.findById(id);

      if (!media) {
        return res.status(404).json({ error: "Media resource not found." });
      }

      // Generate GetObject presigned URL (expires in 10 minutes)
      const downloadUrl = await S3Service.getPresignedGetUrl(media.key);

      return res.status(200).json({
        url: downloadUrl
      });
    } catch (error: any) {
      console.error("Download media error:", error);
      return res.status(500).json({ error: "Failed to generate download signed URL: " + error.message });
    }
  }

  /**
   * Delete media from S3 and database
   */
  static async deleteMedia(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const media = await MediaModel.findById(id);

      if (!media) {
        return res.status(404).json({ error: "Media resource not found." });
      }

      // Verify ownership if deleting user is not Admin/Editor
      if (req.user && req.user.role !== "ADMIN" && req.user.role !== "EDITOR") {
        if (media.uploadedBy !== req.user.id) {
          return res.status(403).json({ error: "Forbidden: You do not own this media resource." });
        }
      }

      // 1. Delete from S3 Bucket
      try {
        await S3Service.deleteObject(media.key);
      } catch (s3Error) {
        console.error("AWS S3 object deletion failure, proceeding with DB removal:", s3Error);
      }

      // 2. Delete from Database
      await MediaModel.hardDelete(id);

      return res.status(200).json({ message: "Media deleted successfully from storage and database." });
    } catch (error: any) {
      console.error("Delete media error:", error);
      return res.status(500).json({ error: "Failed to delete media: " + error.message });
    }
  }
}
