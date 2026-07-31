import { Request, Response } from "express";
import { prisma } from "../config/db";

export class CityController {
  // Get All Cities/Localities (Public)
  static async getCities(req: Request, res: Response) {
    try {
      const { all } = req.query;
      const where: any = {};
      if (all !== "true") {
        where.activeListingsCount = { gt: 0 };
      }

      const cities = await prisma.city.findMany({
        where,
        orderBy: { activeListingsCount: "desc" }
      });
      const cleanCities = cities.map(c => ({
        ...c,
        parentCity: c.parentCity === "null" ? "" : (c.parentCity || "")
      }));
      return res.json(cleanCities);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Add a New City/Locality (Admin Only)
  static async createCity(req: Request, res: Response) {
    try {
      const { name, emoji, imagePath, state, parentCity } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Name is required." });
      }

      const normParent = parentCity || "";

      const existing = await prisma.city.findUnique({
        where: {
          name_parentCity: {
            name,
            parentCity: normParent
          }
        }
      });
      if (existing) {
        return res.status(400).json({ error: "Location already exists." });
      }

      const city = await prisma.city.create({
        data: {
          name,
          emoji: emoji || "📍",
          imagePath: imagePath || null,
          state: state || null,
          parentCity: normParent || null
        }
      });
      return res.status(201).json(city);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "A location with this name already exists in this city." });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  // Update a City/Locality (Admin Only)
  static async updateCity(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { name, emoji, imagePath, state, parentCity } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Name is required." });
      }

      const normParent = parentCity || "";

      const updateData: any = {
        name,
        emoji: emoji || "📍",
        parentCity: normParent || null
      };
      if (imagePath !== undefined) {
        updateData.imagePath =
          imagePath === null || imagePath === "null" || imagePath === ""
            ? null
            : imagePath;
      }
      if (state !== undefined) {
        updateData.state = state;
      }

      const updated = await prisma.city.update({
        where: { id: parseInt(id, 10) },
        data: updateData
      });
      return res.json(updated);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "A location with this name already exists in this city." });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete a City/Locality (Admin Only)
  static async deleteCity(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      await prisma.city.delete({ where: { id: parseInt(id, 10) } });
      return res.json({ message: "Location deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
