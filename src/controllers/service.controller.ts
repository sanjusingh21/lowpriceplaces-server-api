import { Request, Response } from "express";
import { prisma } from "../config/db";
import { calculateDistance } from "../utils/distance";
import { AuthenticatedRequest } from "../middlewares/auth";

export class ServiceController {
  // Get nearby services
  static async getServices(req: Request, res: Response) {
    try {
      const { lat, lng, serviceType, page, limit } = req.query;

      const filter: any = {
        listingType: "SERVICES",
        status: "ACTIVE",
      };

      if (serviceType) {
        filter.OR = [
          {
            category: {
              name: { contains: serviceType as string, mode: "insensitive" },
            },
          },
          {
            subCategory: {
              name: { contains: serviceType as string, mode: "insensitive" },
            },
          },
        ];
      }

      const listings = await prisma.listing.findMany({
        where: filter,
        include: {
          category: true,
          subCategory: true,
          seller: {
            select: { username: true, emailVerified: true },
          },
          reviews: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);

      const mapped = listings.map((l) => {
        let distance: number | null = null;
        if (!isNaN(userLat) && !isNaN(userLng) && l.latitude && l.longitude) {
          distance = calculateDistance(
            userLat,
            userLng,
            l.latitude,
            l.longitude
          );
        }

        const avg =
          l.reviews.length > 0
            ? l.reviews.reduce((acc, curr) => acc + curr.rating, 0) /
              l.reviews.length
            : 0;

        let firstImage: string | null = null;
        if (l.imagePath) {
          const parts = l.imagePath.split(",");
          if (parts.length > 0) {
            firstImage = parts[0].trim();
          }
        }

        return {
          id: l.id,
          name: l.title,
          serviceType: l.subCategory?.name || l.category?.name || "Service",
          categoryName: l.category?.name || "",
          imagePath: firstImage,
          location: l.location,
          latitude: l.latitude,
          longitude: l.longitude,
          price: l.price,
          rating: avg || 5.0,
          averageRating: avg || 5.0,
          totalReviews: l.reviews.length,
          contact: l.whatsappNumber || l.contactNumber || null,
          distance,
          verified: l.seller?.emailVerified || false,
          createdAt: l.createdAt,
        };
      });

      if (!isNaN(userLat) && !isNaN(userLng)) {
        mapped.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0;
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
      }

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      if (!isNaN(pageNum) && !isNaN(limitNum)) {
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = pageNum * limitNum;
        return res.json(mapped.slice(startIndex, endIndex));
      } else {
        return res.json(mapped);
      }
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get specific service detail
  static async getServiceById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { lat, lng } = req.query;

      const listing = await prisma.listing.findFirst({
        where: { id, listingType: "SERVICES" },
        include: {
          category: true,
          subCategory: true,
          seller: {
            select: { username: true, emailVerified: true },
          },
          reviews: {
            include: {
              buyer: {
                select: { username: true },
              },
            },
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      });
      if (!listing) return res.status(404).json({ error: "Service not found" });

      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);
      let distance: number | null = null;
      if (
        !isNaN(userLat) &&
        !isNaN(userLng) &&
        listing.latitude &&
        listing.longitude
      ) {
        distance = calculateDistance(
          userLat,
          userLng,
          listing.latitude,
          listing.longitude
        );
      }

      const relatedListings = await prisma.listing.findMany({
        where: {
          location: { contains: listing.location, mode: "insensitive" },
          status: "ACTIVE",
        },
        include: {
          category: true,
          subCategory: true,
          reviews: {
            select: { rating: true },
          },
        },
        take: 6,
      });

      const avg =
        listing.reviews.length > 0
          ? listing.reviews.reduce((acc, curr) => acc + curr.rating, 0) /
            listing.reviews.length
          : 5.0;

      let firstImage: string | null = null;
      if (listing.imagePath) {
        const parts = listing.imagePath.split(",");
        if (parts.length > 0) {
          firstImage = parts[0].trim();
        }
      }

      const enrichedService = {
        id: listing.id,
        name: listing.title,
        serviceType:
          listing.subCategory?.name || listing.category?.name || "Service",
        imagePath: firstImage,
        location: listing.location,
        latitude: listing.latitude,
        longitude: listing.longitude,
        rating: avg,
        averageRating: avg,
        totalReviews: listing.reviews.length,
        reviews: listing.reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          buyer: r.buyer,
        })),
        contact: listing.whatsappNumber || listing.contactNumber || null,
        distance,
      };

      return res.json({ service: enrichedService, relatedListings });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Create Service
  static async createService(req: Request, res: Response) {
    try {
      const {
        name,
        serviceType,
        icon,
        location,
        latitude,
        longitude,
        rating,
        contact,
        imagePath,
      } = req.body;
      if (!name)
        return res.status(400).json({ error: "Service name is required." });
      if (!serviceType)
        return res.status(400).json({ error: "Service type is required." });
      if (!location)
        return res.status(400).json({ error: "Service location is required." });

      const newService = await prisma.service.create({
        data: {
          name,
          serviceType,
          icon: icon || "🛠️",
          imagePath: imagePath || null,
          location,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          rating: rating ? parseFloat(rating) : 5.0,
          contact: contact || null,
        },
      });
      return res.status(201).json(newService);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Update Service
  static async updateService(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const {
        name,
        serviceType,
        icon,
        location,
        latitude,
        longitude,
        rating,
        contact,
        imagePath,
      } = req.body;
      if (!name)
        return res.status(400).json({ error: "Service name is required." });
      if (!serviceType)
        return res.status(400).json({ error: "Service type is required." });
      if (!location)
        return res.status(400).json({ error: "Service location is required." });

      const updateData: any = {
        name,
        serviceType,
        icon: icon || "🛠️",
        location,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        rating: rating ? parseFloat(rating) : 5.0,
        contact: contact || null,
      };

      if (imagePath !== undefined) {
        updateData.imagePath =
          imagePath === null || imagePath === "null" || imagePath === ""
            ? null
            : imagePath;
      }

      const updatedService = await prisma.service.update({
        where: { id },
        data: updateData,
      });
      return res.json(updatedService);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete Service
  static async deleteService(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      await prisma.service.delete({ where: { id } });
      return res.json({ message: "Service deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Add review to a service
  static async addServiceReview(req: AuthenticatedRequest, res: Response) {
    try {
      const serviceId = parseInt(req.params.id as string, 10);
      const { rating, comment } = req.body;
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const buyerId = req.user.id;

      if (!rating || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ error: "Rating must be between 1 and 5" });
      }

      const newReview = await prisma.review.create({
        data: {
          listingId: serviceId,
          buyerId,
          rating: parseInt(rating),
          comment: comment || "",
        },
        include: {
          buyer: {
            select: { username: true },
          },
        },
      });

      return res.status(201).json(newReview);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
