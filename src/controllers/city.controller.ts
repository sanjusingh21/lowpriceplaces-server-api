import { Request, Response } from "express";
import { prisma } from "../config/db";

export class CityController {
  // Get All Cities (Public)
  static async getCities(req: Request, res: Response) {
    try {
      const { all } = req.query;
      const where: any = {};
      if (all !== "true") {
        where.activeListingsCount = { gt: 0 };
      }

      const cities = await prisma.city.findMany({
        where,
        include: {
          subCities: {
            where: all !== "true" ? { activeListingsCount: { gt: 0 } } : undefined,
            orderBy: { name: "asc" }
          }
        },
        orderBy: { name: "asc" }
      });
      return res.json(cities);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Add a New City (Admin Only)
  static async createCity(req: Request, res: Response) {
    try {
      const { name, emoji, imagePath, state } = req.body;
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
          state: state || null,
        },
        include: {
          subCities: true
        }
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
      const { name, emoji, imagePath, state } = req.body;
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
      if (state !== undefined) {
        updateData.state = state;
      }

      const updated = await prisma.city.update({
        where: { id: parseInt(id, 10) },
        data: updateData,
        include: {
          subCities: {
            orderBy: { name: "asc" }
          }
        }
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

  // Get Sub-Cities for a given City (Public)
  static async getSubCitiesForCity(req: Request, res: Response) {
    try {
      const { cityId } = req.params as { cityId: string };
      const subCities = await prisma.subCity.findMany({
        where: { cityId: parseInt(cityId, 10) },
        orderBy: { name: "asc" }
      });
      return res.json(subCities);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get All Sub-Cities with optional search (Public)
  static async getAllSubCities(req: Request, res: Response) {
    try {
      const { search } = req.query as { search?: string };
      const where: any = {};
      if (search) {
        where.name = { contains: search, mode: "insensitive" };
      }
      const subCities = await prisma.subCity.findMany({
        where,
        include: { city: true },
        orderBy: { name: "asc" }
      });
      return res.json(subCities);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Create Sub-City (Admin Only)
  static async createSubCity(req: Request, res: Response) {
    try {
      const { name, emoji, cityId } = req.body;
      if (!name || !cityId) {
        return res.status(400).json({ error: "Sub-city name and city ID are required." });
      }
      const subCity = await prisma.subCity.create({
        data: {
          name,
          emoji: emoji || "📍",
          cityId: parseInt(cityId, 10)
        },
        include: { city: true }
      });
      return res.status(201).json(subCity);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res.status(400).json({ error: "A sub-city with this name already exists in this city." });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  // Update Sub-City (Admin Only)
  static async updateSubCity(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { name, emoji, cityId } = req.body;
      if (!name || !cityId) {
        return res.status(400).json({ error: "Sub-city name and city ID are required." });
      }
      const updated = await prisma.subCity.update({
        where: { id: parseInt(id, 10) },
        data: {
          name,
          emoji: emoji || "📍",
          cityId: parseInt(cityId, 10)
        },
        include: { city: true }
      });
      return res.json(updated);
    } catch (error: any) {
      if (error.code === "P2002") {
        return res.status(400).json({ error: "A sub-city with this name already exists in this city." });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete Sub-City (Admin Only)
  static async deleteSubCity(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      await prisma.subCity.delete({ where: { id: parseInt(id, 10) } });
      return res.json({ message: "Sub-city deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
