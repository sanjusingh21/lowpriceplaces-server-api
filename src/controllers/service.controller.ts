import { Request, Response } from "express";
import { prisma } from "../config/db";
import { calculateDistance } from "../utils/distance";
import { AuthenticatedRequest } from "../middlewares/auth";

export class ServiceController {
  // Get nearby services
  static async getServices(req: Request, res: Response) {
    try {
      const { lat, lng, serviceType, page, limit, location } = req.query;

      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);
      const hasCoordinates = !isNaN(userLat) && !isNaN(userLng);

      // 1. Fetch listings
      const listingFilter: any = {
        listingType: "SERVICES",
        status: "ACTIVE",
        categoryId: { not: 39 }, // Exclude "All stores" category
      };

      if (serviceType) {
        listingFilter.OR = [
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
        where: listingFilter,
        include: {
          category: true,
          subCategory: true,
          seller: {
            select: { username: true, emailVerified: true },
          },
          reviews: true,
        },
      });

      const mappedListings = listings.map((l) => {
        let distance: number | null = null;
        if (hasCoordinates && l.latitude && l.longitude) {
          distance = calculateDistance(userLat, userLng, l.latitude, l.longitude);
        }

        const avg = l.reviews.length > 0
          ? l.reviews.reduce((acc, curr) => acc + curr.rating, 0) / l.reviews.length
          : 5.0;

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
          rating: avg,
          averageRating: avg,
          totalReviews: l.reviews.length,
          contact: l.whatsappNumber || l.contactNumber || null,
          distance,
          verified: l.seller?.emailVerified || false,
          createdAt: l.createdAt,
          isListing: true,
        };
      });

      // 2. Fetch static services
      const serviceFilter: any = {};
      if (serviceType) {
        serviceFilter.serviceType = { contains: serviceType as string, mode: "insensitive" };
      }
      const staticServices = await prisma.service.findMany({
        where: serviceFilter,
        include: {
          reviews: true,
        },
      });

      const mappedStatic = staticServices.map((s) => {
        let distance: number | null = null;
        if (hasCoordinates && s.latitude && s.longitude) {
          distance = calculateDistance(userLat, userLng, s.latitude, s.longitude);
        }
        const avg = s.reviews.length > 0
          ? s.reviews.reduce((acc, curr) => acc + curr.rating, 0) / s.reviews.length
          : s.rating;
        return {
          id: s.id,
          name: s.name,
          serviceType: s.serviceType,
          categoryName: "Services",
          imagePath: s.imagePath || null,
          location: s.location || "",
          latitude: s.latitude,
          longitude: s.longitude,
          price: 0,
          rating: avg,
          averageRating: avg,
          totalReviews: s.reviews.length,
          contact: s.contact || null,
          distance,
          verified: false,
          createdAt: s.createdAt || new Date(),
          isListing: false,
        };
      });

      // Combine both sources
      const combined = [...mappedListings, ...mappedStatic];

      // Location filtering & fallbacks
      let finalResults = combined;
      if (location && (location as string).trim() !== "") {
        const queryLower = (location as string).toLowerCase().trim();
        const primarySegment = queryLower.split(',')[0].trim();

        // Step A: Filter by city/local match
        let localMatches = combined.filter(item => {
          if (!item.location) return false;
          return item.location.toLowerCase().includes(primarySegment);
        });

        // Step B: Fallback to state match if < 5 local matches
        if (localMatches.length < 5) {
          const parts = queryLower.split(',');
          const stateSegment = parts.length > 1 ? parts[parts.length - 1].trim() : "";
          if (stateSegment && stateSegment !== "india") {
            const stateMatches = combined.filter(item => {
              if (!item.location) return false;
              return item.location.toLowerCase().includes(stateSegment);
            });
            if (stateMatches.length >= 5) {
              localMatches = stateMatches;
            } else {
              // Nationwide fallback
              localMatches = combined;
            }
          } else {
            // Nationwide fallback
            localMatches = combined;
          }
        }
        finalResults = localMatches;
      }

      // Sorting
      if (hasCoordinates) {
        finalResults.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0;
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
      } else {
        // Fallback: sort newest first
        finalResults.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });
      }

      // Pagination
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      if (!isNaN(pageNum) && !isNaN(limitNum)) {
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = pageNum * limitNum;
        return res.json(finalResults.slice(startIndex, endIndex));
      } else {
        return res.json(finalResults);
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
        where: { id, listingType: "SERVICES", categoryId: { not: 39 } },
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
