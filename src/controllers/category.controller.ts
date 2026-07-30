import { Request, Response } from "express";
import { prisma } from "../config/db";

export class CategoryController {
  // Get Categories & Subcategories
  static async getCategories(req: Request, res: Response) {
    try {
      const categories = await prisma.category.findMany({
        include: { subCategories: true },
      });
      return res.json(categories);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Create Category
  static async createCategory(req: Request, res: Response) {
    try {
      const { name, emoji, imagePath } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Category name is required." });
      }
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const category = await prisma.category.create({
        data: { name, slug, emoji: emoji || "📁", imagePath: imagePath || null },
      });
      return res.status(201).json(category);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "A category with this name already exists." });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  // Update Category
  static async updateCategory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { name, emoji, imagePath } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Category name is required." });
      }
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const updateData: any = { name, slug, emoji: emoji || "📁" };
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
      return res.json(updated);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "A category with this name already exists." });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete Category
  static async deleteCategory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      await prisma.category.delete({ where: { id } });
      return res.json({ message: "Category deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Create Subcategory
  static async createSubcategory(req: Request, res: Response) {
    try {
      const { name, emoji, imagePath } = req.body;
      const categoryId = parseInt(req.params.categoryId as string, 10);
      if (!name) {
        return res.status(400).json({ error: "Subcategory name is required." });
      }
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const subCategory = await prisma.subCategory.create({
        data: {
          name,
          slug,
          emoji: emoji || "🔹",
          imagePath: imagePath || null,
          categoryId,
        },
      });
      return res.status(201).json(subCategory);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Update Subcategory
  static async updateSubcategory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { name, emoji, imagePath } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Subcategory name is required." });
      }
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const updateData: any = { name, slug, emoji: emoji || "🔹" };
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
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete Subcategory
  static async deleteSubcategory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      await prisma.subCategory.delete({ where: { id } });
      return res.json({ message: "Subcategory deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
