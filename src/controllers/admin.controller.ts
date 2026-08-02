import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db";
import { AuthenticatedRequest } from "../middlewares/auth";

export class AdminController {
  // Fetch All Users
  static async getUsers(req: Request, res: Response) {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          role: true,
          phoneNumber: true,
          whatsappNumber: true,
        },
      });
      return res.json(users);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Update User Role
  static async updateUserRole(req: Request, res: Response) {
    try {
      const userId = parseInt(req.params.id as string, 10);
      const { role } = req.body;

      const validRoles = ["ADMIN", "EDITOR", "SEO", "USER"];
      const userRole = (role || "").toUpperCase();
      if (!validRoles.includes(userRole)) {
        return res.status(400).json({ error: "Invalid role." });
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { role: userRole },
      });

      return res.json({
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Create User
  static async createUser(req: Request, res: Response) {
    try {
      const { username, role, phoneNumber, whatsappNumber } = req.body;
      if (!username || !role) {
        return res
          .status(400)
          .json({ error: "Username and role are required." });
      }
      const validRoles = ["ADMIN", "EDITOR", "SEO", "USER"];
      const userRole = role.toUpperCase();
      if (!validRoles.includes(userRole)) {
        return res.status(400).json({ error: "Invalid role." });
      }
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists." });
      }
      const hashedPassword = bcrypt.hashSync("password123", 10);
      const user = await prisma.user.create({
        data: {
          username,
          role: userRole,
          password: hashedPassword,
          phoneNumber: phoneNumber || null,
          whatsappNumber: whatsappNumber || null,
        },
      });
      return res.status(201).json({
        id: user.id,
        username: user.username,
        role: user.role,
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Update User
  static async updateUser(req: Request, res: Response) {
    try {
      const userId = parseInt(req.params.id as string, 10);
      const { username, role, phoneNumber, whatsappNumber } = req.body;
      if (!username || !role) {
        return res
          .status(400)
          .json({ error: "Username and role are required." });
      }
      const validRoles = ["ADMIN", "EDITOR", "SEO", "USER"];
      const userRole = role.toUpperCase();
      if (!validRoles.includes(userRole)) {
        return res.status(400).json({ error: "Invalid role." });
      }
      const existingUser = await prisma.user.findFirst({
        where: {
          username,
          id: { not: userId },
        },
      });
      if (existingUser) {
        return res
          .status(400)
          .json({ error: "Username already registered by another user." });
      }
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          username,
          role: userRole,
          phoneNumber: phoneNumber || null,
          whatsappNumber: whatsappNumber || null,
        },
      });
      return res.json({
        id: updated.id,
        username: updated.username,
        role: updated.role,
        phoneNumber: updated.phoneNumber,
        whatsappNumber: updated.whatsappNumber,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete User
  static async deleteUser(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const userId = parseInt(req.params.id as string, 10);
      if (req.user.id === userId) {
        return res
          .status(400)
          .json({ error: "Cannot delete your own administrative account." });
      }
      await prisma.user.delete({ where: { id: userId } });
      return res.json({ message: "User deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get all seller profiles
  static async getSellerProfiles(req: Request, res: Response) {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const profiles = await prisma.profile.findMany({
        where: {
          isStore: true,
          businessCategory: { notIn: ["", "General", "None"] },
        },
        include: {
          user: {
            select: {
              username: true,
              role: true,
            },
          },
        },
        orderBy: {
          id: "desc",
        },
      });
      return res.json(profiles);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete seller profile
  static async deleteSellerProfile(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const profile = await prisma.profile.findUnique({ where: { id } });
      if (profile) {
        await prisma.profile.update({
          where: { id },
          data: {
            isStore: false,
            businessCategory: "",
            businessType: null,
            aboutSeller: "",
          },
        });
      }
      return res.json({ message: "Seller profile store deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
