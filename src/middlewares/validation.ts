import { Request, Response, NextFunction } from "express";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml"
];

const ALLOWED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".svg"
];

const ALLOWED_FOLDERS_REGEX = /^(users\/\d+\/(profile|gallery)|posts\/\d+|products\/\d+|admin|temp|categories|subcategories|cities|stores|services)$/;

export const validatePresignedUpload = (req: Request, res: Response, next: NextFunction) => {
  let { folder, fileName, contentType } = req.body;

  if (!folder || !fileName || !contentType) {
    return res.status(400).json({ error: "Missing required fields: folder, fileName, contentType" });
  }

  // 1. Prevent Path Traversal in Folder field
  if (folder.includes("..") || folder.includes("\\")) {
    return res.status(400).json({ error: "Invalid path traversal elements in folder path." });
  }

  const userId = (req as any).user?.id;
  const userRole = (req as any).user?.role;

  // Resolve generic aliases to secure S3 folders using logged-in user context
  if (folder === "profile") {
    folder = `users/${userId}/profile`;
  } else if (folder === "gallery" || folder === "products" || folder === "posts") {
    folder = `users/${userId}/gallery`;
  } else if (folder === "admin") {
    if (userRole !== "ADMIN" && userRole !== "EDITOR") {
      return res.status(403).json({ error: "Forbidden: Only admins can upload to the admin folder." });
    }
    folder = "admin";
  } else if (["categories", "subcategories", "cities", "stores", "services"].includes(folder)) {
    if (userRole !== "ADMIN" && userRole !== "EDITOR") {
      return res.status(403).json({ error: "Forbidden: Only admins or editors can upload to admin assets folders." });
    }
  } else if (folder === "temp") {
    folder = "temp";
  }

  // Verify structure is compliant with folder layouts
  if (!ALLOWED_FOLDERS_REGEX.test(folder)) {
    return res.status(400).json({ error: "Invalid folder structure. Must match allowed patterns (e.g., users/{id}/profile, posts/{id}, products/{id}, admin, temp, categories, subcategories, cities, stores, services)." });
  }

  // Ownership verification: user can only upload to their own user directory
  const userFolderMatch = folder.match(/^users\/(\d+)\//);
  if (userFolderMatch) {
    const targetUserId = parseInt(userFolderMatch[1], 10);
    if (userRole !== "ADMIN" && userRole !== "EDITOR" && targetUserId !== userId) {
      return res.status(403).json({ error: "Forbidden: You can only upload files to your own user directory." });
    }
  }

  // Write resolved secure folder back to req.body so the controller uses the secure resolved path
  req.body.folder = folder;

  // 2. Validate Mime Type
  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    return res.status(400).json({ error: `Unsupported mime type: ${contentType}. Only standard image types are allowed.` });
  }

  // 3. Validate Extension
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) {
    return res.status(400).json({ error: "File name must have an extension." });
  }
  const extension = fileName.substring(lastDot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return res.status(400).json({ error: `Unsupported file extension: ${extension}.` });
  }

  next();
};

export const validateUploadComplete = (req: Request, res: Response, next: NextFunction) => {
  const { key, type, size } = req.body;

  if (!key || !type || !size) {
    return res.status(400).json({ error: "Missing required fields: key, type, size" });
  }

  // Validate file size limit: 10MB max
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (size > maxSize) {
    return res.status(400).json({ error: "File exceeds maximum size limit of 10MB." });
  }

  // Validate type (must start with image/)
  if (!type.startsWith("image/")) {
    return res.status(400).json({ error: "Invalid content type. Only images are supported." });
  }

  next();
};
