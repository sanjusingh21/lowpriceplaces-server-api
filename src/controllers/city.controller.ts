import { Request, Response } from "express";
import { prisma } from "../config/db";

export class CityController {
  // Get All Cities (Public)
  static async getCities(req: Request, res: Response) {
    try {
      const cities = await prisma.city.findMany({ orderBy: { name: "asc" } });
      return res.json(cities);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Add a New City (Admin Only)
  static async createCity(req: Request, res: Response) {
    try {
      const { name, emoji, imagePath } = req.body;
      if (!name) {
        return res.status(400).json({ error: "City name is required." });
      }

      const existing = await prisma.city.findUnique({ where: { name } });
      if (existing) {
        return res.status(400).json({ error: "City already exists." });
      }

      const city = await prisma.city.create({
        data: {
          name,
          emoji: emoji || "📍",
          imagePath: imagePath || null,
        },
      });
      return res.status(201).json(city);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "A city with this name already exists." });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  // Update a City (Admin Only)
  static async updateCity(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { name, emoji, imagePath } = req.body;
      if (!name) {
        return res.status(400).json({ error: "City name is required." });
      }

      const updateData: any = { name, emoji: emoji || "📍" };
      if (imagePath !== undefined) {
        updateData.imagePath =
          imagePath === null || imagePath === "null" || imagePath === ""
            ? null
            : imagePath;
      }

      const updated = await prisma.city.update({
        where: { id: parseInt(id, 10) },
        data: updateData,
      });
      return res.json(updated);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "A city with this name already exists." });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete a City (Admin Only)
  static async deleteCity(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      await prisma.city.delete({ where: { id: parseInt(id, 10) } });
      return res.json({ message: "City deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
