import { Request, Response } from "express";
import { prisma } from "../config/db";
import { S3Service } from "../services/s3.service";

export class CategoryController {
  // Get Categories & Subcategories
  static async getCategories(req: Request, res: Response) {
    try {
      const categories = await prisma.category.findMany({
        include: { subCategories: true },
        orderBy: { name: "asc" },
      });
      return res.json(categories);
    } catch (error: any) {
      console.error("Error in getCategories:", error);
      return res.status(500).json({ error: error.message || "Failed to fetch categories." });
    }
  }

  // Create Category
  static async createCategory(req: Request, res: Response) {
    try {
      const { name, emoji, imagePath } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Category name is required." });
      }

      const cleanName = name.trim();
      const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const category = await prisma.category.create({
        data: {
          name: cleanName,
          slug,
          emoji: emoji ? emoji.trim() : "📁",
          imagePath: imagePath === "" || imagePath === "null" ? null : imagePath || null,
        },
      });
      return res.status(201).json(category);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "A category with this name already exists." });
      }
      console.error("Error in createCategory:", error);
      return res.status(500).json({ error: error.message || "Failed to create category." });
    }
  }

  // Update Category
  static async updateCategory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid category ID." });
      }

      const { name, emoji, imagePath } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Category name is required." });
      }

      const existingCategory = await prisma.category.findUnique({ where: { id } });
      if (!existingCategory) {
        return res.status(404).json({ error: "Category not found." });
      }

      const cleanName = name.trim();
      const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const updateData: any = {
        name: cleanName,
        slug,
        emoji: emoji ? emoji.trim() : "📁",
      };

      if (imagePath !== undefined) {
        updateData.imagePath =
          imagePath === null || imagePath === "null" || imagePath === ""
            ? null
            : imagePath;
      }

      const updated = await prisma.category.update({
        where: { id },
        data: updateData,
      });

      // Asynchronously cleanup old image if replaced or removed
      if (
        existingCategory.imagePath &&
        existingCategory.imagePath !== updated.imagePath &&
        existingCategory.imagePath.includes("/api/media/view/")
      ) {
        try {
          const oldKey = existingCategory.imagePath.split("/api/media/view/")[1];
          if (oldKey) {
            S3Service.deleteObject(oldKey).catch((err) =>
              console.error("Non-blocking old category image S3 cleanup warning:", err)
            );
          }
        } catch (cleanupErr) {
          console.error("Failed to parse old category image key:", cleanupErr);
        }
      }

      return res.json(updated);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "A category with this name already exists." });
      }
      if (error.code === "P2025") {
        return res.status(404).json({ error: "Category not found." });
      }
      console.error("Error in updateCategory:", error);
      return res.status(500).json({ error: error.message || "Failed to update category." });
    }
  }

  // Delete Category
  static async deleteCategory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid category ID." });
      }

      const existingCategory = await prisma.category.findUnique({ where: { id } });
      if (!existingCategory) {
        return res.json({ message: "Category deleted or removed successfully." });
      }

      await prisma.category.delete({ where: { id } });

      // Asynchronously cleanup deleted category image
      if (existingCategory.imagePath && existingCategory.imagePath.includes("/api/media/view/")) {
        try {
          const oldKey = existingCategory.imagePath.split("/api/media/view/")[1];
          if (oldKey) {
            S3Service.deleteObject(oldKey).catch((err) =>
              console.error("Non-blocking deleted category image S3 cleanup warning:", err)
            );
          }
        } catch (cleanupErr) {
          console.error("Failed to parse deleted category image key:", cleanupErr);
        }
      }

      return res.json({ message: "Category deleted successfully." });
    } catch (error: any) {
      if (error.code === "P2025") {
        return res.json({ message: "Category deleted or removed successfully." });
      }
      if (error.code === "P2003") {
        return res
          .status(400)
          .json({ error: "Cannot delete category with associated subcategories or listings." });
      }
      console.error("Error in deleteCategory:", error);
      return res.status(500).json({ error: error.message || "Failed to delete category." });
    }
  }

  // Create Subcategory
  static async createSubcategory(req: Request, res: Response) {
    try {
      const { name, emoji, imagePath } = req.body;
      const categoryId = parseInt(req.params.categoryId as string, 10);
      if (isNaN(categoryId)) {
        return res.status(400).json({ error: "Invalid parent category ID." });
      }
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Subcategory name is required." });
      }

      const cleanName = name.trim();
      const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const subCategory = await prisma.subCategory.create({
        data: {
          name: cleanName,
          slug,
          emoji: emoji ? emoji.trim() : "🔹",
          imagePath: imagePath === "" || imagePath === "null" ? null : imagePath || null,
          categoryId,
        },
      });
      return res.status(201).json(subCategory);
    } catch (error: any) {
      console.error("Error in createSubcategory:", error);
      return res.status(500).json({ error: error.message || "Failed to create subcategory." });
    }
  }

  // Update Subcategory
  static async updateSubcategory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid subcategory ID." });
      }

      const { name, emoji, imagePath } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Subcategory name is required." });
      }

      const existingSub = await prisma.subCategory.findUnique({ where: { id } });
      if (!existingSub) {
        return res.status(404).json({ error: "Subcategory not found." });
      }

      const cleanName = name.trim();
      const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const updateData: any = {
        name: cleanName,
        slug,
        emoji: emoji ? emoji.trim() : "🔹",
      };

      if (imagePath !== undefined) {
        updateData.imagePath =
          imagePath === null || imagePath === "null" || imagePath === ""
            ? null
            : imagePath;
      }

      const updated = await prisma.subCategory.update({
        where: { id },
        data: updateData,
      });

      // Asynchronously cleanup old image if replaced or removed
      if (
        existingSub.imagePath &&
        existingSub.imagePath !== updated.imagePath &&
        existingSub.imagePath.includes("/api/media/view/")
      ) {
        try {
          const oldKey = existingSub.imagePath.split("/api/media/view/")[1];
          if (oldKey) {
            S3Service.deleteObject(oldKey).catch((err) =>
              console.error("Non-blocking old subcategory image S3 cleanup warning:", err)
            );
          }
        } catch (cleanupErr) {
          console.error("Failed to parse old subcategory image key:", cleanupErr);
        }
      }

      return res.json(updated);
    } catch (error: any) {
      if (error.code === "P2025") {
        return res.status(404).json({ error: "Subcategory not found." });
      }
      console.error("Error in updateSubcategory:", error);
      return res.status(500).json({ error: error.message || "Failed to update subcategory." });
    }
  }

  // Delete Subcategory
  static async deleteSubcategory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid subcategory ID." });
      }

      const existingSub = await prisma.subCategory.findUnique({ where: { id } });
      if (!existingSub) {
        return res.json({ message: "Subcategory deleted or removed successfully." });
      }

      await prisma.subCategory.delete({ where: { id } });

      // Asynchronously cleanup deleted subcategory image
      if (existingSub.imagePath && existingSub.imagePath.includes("/api/media/view/")) {
        try {
          const oldKey = existingSub.imagePath.split("/api/media/view/")[1];
          if (oldKey) {
            S3Service.deleteObject(oldKey).catch((err) =>
              console.error("Non-blocking deleted subcategory image S3 cleanup warning:", err)
            );
          }
        } catch (cleanupErr) {
          console.error("Failed to parse deleted subcategory image key:", cleanupErr);
        }
      }

      return res.json({ message: "Subcategory deleted successfully." });
    } catch (error: any) {
      if (error.code === "P2025") {
        return res.json({ message: "Subcategory deleted or removed successfully." });
      }
      if (error.code === "P2003") {
        return res
          .status(400)
          .json({ error: "Cannot delete subcategory with associated listings." });
      }
      console.error("Error in deleteSubcategory:", error);
      return res.status(500).json({ error: error.message || "Failed to delete subcategory." });
    }
  }
}
