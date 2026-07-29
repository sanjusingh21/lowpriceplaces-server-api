import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/db";
import { JWT_SECRET, AuthenticatedRequest } from "../middlewares/auth";
import { promoteListingImages } from "../utils/s3Promoter";

import { sendResetEmail } from "../services/mailer.service";

export class AuthController {
  // Admin / CMS User Login
  static async login(req: Request, res: Response) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password are required." });
      }

      let user = await prisma.user.findFirst({
        where: {
          username,
          role: {
            in: ["ADMIN", "EDITOR", "SEO"],
          },
        },
      });

      if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(400).json({ error: "Invalid username or password." });
      }

      user = await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          phoneNumber: user.phoneNumber,
          whatsappNumber: user.whatsappNumber,
          fullName: user.fullName,
          profilePicture: user.profilePicture,
          provider: user.provider,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Forgot Password - Send Reset Link (Admin CMS Only)
  static async forgotPassword(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required." });

      const user = await prisma.user.findUnique({ where: { username: email } });
      if (!user || !["ADMIN", "EDITOR", "SEO"].includes(user.role)) {
        return res.status(403).json({
          error:
            "Access Denied, No User Found !",
        });
      }

      const resetToken = jwt.sign(
        { id: user.id, email: user.username },
        JWT_SECRET,
        { expiresIn: "15m" }
      );
      const resetLink = `${process.env.ADMIN_URL || process.env.LOCAL_URL}/#/reset-password?token=${resetToken}`;

      await sendResetEmail(email, resetLink);

      return res.json({
        message:
          "Password reset link sent to authorized administrative email inbox.",
        resetLink,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Reset Password - Verify Token & Save New Password
  static async resetPassword(req: Request, res: Response) {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res
          .status(400)
          .json({ error: "Token and new password are required." });
      }

      let decoded: any;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (e) {
        return res.status(400).json({ error: "Invalid or expired reset token." });
      }

      const userId = decoded.id;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !["ADMIN", "EDITOR", "SEO"].includes(user.role)) {
        return res.status(403).json({
          error:
            "Access Denied, No User Found !",
        });
      }

      const hashedPassword = bcrypt.hashSync(newPassword, 10);

      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });

      return res.json({
        message:
          "Password reset successfully. You can now login with your new password.",
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get Current User Profile
  static async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          username: true,
          role: true,
          phoneNumber: true,
          whatsappNumber: true,
          fullName: true,
          profilePicture: true,
        },
      });
      return res.json(user);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Google Auth Sign-In / Sign-Up
  static async googleAuth(req: Request, res: Response) {
    try {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: "Credential token is required." });
      }

      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
      );
      if (!response.ok) {
        return res.status(400).json({ error: "Invalid Google token." });
      }
      const payload: any = await response.json();
      const email = payload.email;
      if (!email) {
        return res
          .status(400)
          .json({ error: "Email not retrieved from Google." });
      }

      const googleId = payload.sub;
      const fullName = payload.name || "";
      const profilePicture = payload.picture || null;

      let user = await prisma.user.findUnique({ where: { username: email } });
      if (!user) {
        const randomPassword = bcrypt.hashSync(Math.random().toString(36), 10);
        user = await prisma.user.create({
          data: {
            username: email,
            password: randomPassword,
            role: "USER",
            fullName,
            googleId,
            profilePicture,
            provider: "GOOGLE",
            emailVerified: true,
            lastLogin: new Date(),
          },
        });
        await prisma.profile.create({
          data: {
            userId: user.id,
            fullName: email.split("@")[0],
            displayName: email.split("@")[0],
            professionalTitle: "Independent Member",
            yearsOfExperience: 0,
            businessCategory: "General",
            email: email,
            aboutSeller: "New user on lowpriceplaces.",
            showWhatsapp: true,
            showPhone: true,
            allowChat: true,
          },
        });
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLogin: new Date(),
            fullName: user.fullName || fullName,
            googleId: user.googleId || googleId,
            profilePicture: user.profilePicture || profilePicture,
            provider: user.provider === "MANUAL" ? "GOOGLE" : user.provider,
            emailVerified: true,
          },
        });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );
      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          phoneNumber: user.phoneNumber,
          whatsappNumber: user.whatsappNumber,
          fullName: user.fullName,
          profilePicture: user.profilePicture,
          provider: user.provider,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get Seller Profile
  static async getProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const profile = await prisma.profile.findUnique({
        where: { userId: req.user.id },
      });
      return res.json(
        profile || {
          fullName: "",
          displayName: "",
          professionalTitle: "",
          yearsOfExperience: 0,
          businessCategory: "",
          businessType: "",
          aboutSeller: "",
          email: "",
          mobileNumber: "",
          whatsAppNumber: "",
          showWhatsapp: true,
          showPhone: true,
          allowChat: true,
          location: "",
          latitude: null,
          longitude: null,
          imagePath: null,
        }
      );
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Create/Update Seller Profile
  static async updateProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const {
        fullName,
        displayName,
        professionalTitle,
        yearsOfExperience,
        businessCategory,
        businessType,
        aboutSeller,
        email,
        mobileNumber,
        whatsAppNumber,
        showWhatsapp,
        showPhone,
        allowChat,
        location,
        latitude,
        longitude,
        imagePath: providedImagePath,
      } = req.body;

      const existingProfile = await prisma.profile.findUnique({
        where: { userId: req.user.id },
      });

      const parsedLat = latitude ? parseFloat(latitude) : null;
      const parsedLng = longitude ? parseFloat(longitude) : null;

      const imagePath =
        providedImagePath !== undefined
          ? providedImagePath
          : existingProfile
          ? existingProfile.imagePath
          : null;

      const profile = await prisma.profile.upsert({
        where: { userId: req.user.id },
        update: {
          fullName: fullName || "",
          displayName: displayName || "",
          professionalTitle: professionalTitle || "",
          yearsOfExperience: parseInt(yearsOfExperience) || 0,
          businessCategory: businessCategory || "",
          businessType: businessType || null,
          aboutSeller: aboutSeller || "",
          email: email || "",
          mobileNumber: mobileNumber || null,
          whatsAppNumber: whatsAppNumber || null,
          showWhatsapp: showWhatsapp !== "false" && showWhatsapp !== false,
          showPhone: showPhone !== "false" && showPhone !== false,
          allowChat: allowChat !== "false" && allowChat !== false,
          location: location || null,
          latitude: isNaN(parsedLat as number) ? null : parsedLat,
          longitude: isNaN(parsedLng as number) ? null : parsedLng,
          imagePath,
        },
        create: {
          userId: req.user.id,
          fullName: fullName || "",
          displayName: displayName || "",
          professionalTitle: professionalTitle || "",
          yearsOfExperience: parseInt(yearsOfExperience) || 0,
          businessCategory: businessCategory || "",
          businessType: businessType || null,
          aboutSeller: aboutSeller || "",
          email: email || "",
          mobileNumber: mobileNumber || null,
          whatsAppNumber: whatsAppNumber || null,
          showWhatsapp: showWhatsapp !== "false" && showWhatsapp !== false,
          showPhone: showPhone !== "false" && showPhone !== false,
          allowChat: allowChat !== "false" && allowChat !== false,
          location: location || null,
          latitude: isNaN(parsedLat as number) ? null : parsedLat,
          longitude: isNaN(parsedLng as number) ? null : parsedLng,
          imagePath,
        },
      });

      if (imagePath) {
        await prisma.user.update({
          where: { id: req.user.id },
          data: { profilePicture: imagePath },
        });
        await promoteListingImages(imagePath);
      }

      return res.json(profile);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
