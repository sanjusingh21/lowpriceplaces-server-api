import { Request, Response } from "express";
import { prisma } from "../config/db";
import { AuthenticatedRequest } from "../middlewares/auth";

export class ReviewController {
  // Create Review for a listing
  static async createListingReview(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const listingId = parseInt(req.params.id as string, 10);
      const { rating, comment, images, videos } = req.body;

      if (!rating || !comment) {
        return res
          .status(400)
          .json({ error: "Rating (1-5) and comment are required." });
      }

      const review = await prisma.review.create({
        data: {
          listingId,
          buyerId: req.user.id,
          rating: parseInt(rating),
          comment,
          images: Array.isArray(images) ? images : [],
          videos: Array.isArray(videos) ? videos : [],
        },
        include: {
          buyer: { select: { username: true } },
        },
      });

      return res.status(201).json(review);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete Review
  static async deleteReview(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const reviewId = parseInt(req.params.id as string, 10);
      const review = await prisma.review.findUnique({ where: { id: reviewId } });
      if (!review) return res.status(404).json({ error: "Review not found" });

      if (
        req.user.role !== "ADMIN" &&
        req.user.role !== "EDITOR" &&
        review.buyerId !== req.user.id
      ) {
        return res.status(403).json({ error: "Forbidden: Action not allowed." });
      }

      await prisma.review.delete({ where: { id: reviewId } });
      return res.json({ message: "Review deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
