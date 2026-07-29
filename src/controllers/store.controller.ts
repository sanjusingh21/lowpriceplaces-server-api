import { Request, Response } from "express";
import { prisma } from "../config/db";
import { calculateDistance } from "../utils/distance";
import { AuthenticatedRequest } from "../middlewares/auth";

export class StoreController {
  // Get nearby stores (filtered by category, sorted by distance)
  static async getStores(req: Request, res: Response) {
    try {
      const { lat, lng, category, page, limit } = req.query;

      const filter: any = {};
      if (category) {
        filter.category = category as string;
      }

      const stores = await prisma.store.findMany({
        where: filter,
        include: {
          reviews: true,
        },
      });

      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);

      const mappedStores = stores.map((store) => {
        let distance: number | null = null;
        if (
          !isNaN(userLat) &&
          !isNaN(userLng) &&
          store.latitude &&
          store.longitude
        ) {
          distance = calculateDistance(
            userLat,
            userLng,
            store.latitude,
            store.longitude
          );
        }

        const avg =
          store.reviews.length > 0
            ? store.reviews.reduce((acc, curr) => acc + curr.rating, 0) /
              store.reviews.length
            : store.rating;

        return {
          ...store,
          distance,
          averageRating: Number(avg.toFixed(1)),
          totalReviews: store.reviews.length,
          isSellerProfile: false,
        };
      });

      // Query seller profiles
      const hasCoordinates = !isNaN(userLat) && !isNaN(userLng);
      let profiles: any[] = [];
      let usedRecentFallback = false;

      if (hasCoordinates) {
        const profileFilter: any = {
          latitude: { not: null },
          longitude: { not: null },
        };
        if (category) {
          profileFilter.businessCategory = category as string;
        }

        const tempProfiles = await prisma.profile.findMany({
          where: profileFilter,
          include: {
            reviews: true,
          },
        });

        const profilesWithDistance = tempProfiles.map((profile) => {
          const distance = calculateDistance(
            userLat,
            userLng,
            profile.latitude,
            profile.longitude
          );
          const avg =
            profile.reviews.length > 0
              ? profile.reviews.reduce((acc, curr) => acc + curr.rating, 0) /
                profile.reviews.length
              : 5.0;
          return {
            id: -profile.userId,
            name: profile.displayName || profile.fullName,
            category: profile.businessCategory,
            imagePath: profile.imagePath || null,
            location: profile.location || "",
            latitude: profile.latitude,
            longitude: profile.longitude,
            rating: avg,
            contact: profile.whatsAppNumber || profile.mobileNumber || "",
            createdAt: new Date(),
            distance,
            averageRating: Number(avg.toFixed(1)),
            totalReviews: profile.reviews.length,
            isSellerProfile: true,
          };
        });

        const nearbyProfiles = profilesWithDistance.filter(
          (p) => p.distance !== null && p.distance <= 50
        );

        if (nearbyProfiles.length > 0) {
          profiles = nearbyProfiles;
        } else {
          usedRecentFallback = true;
        }
      } else {
        usedRecentFallback = true;
      }

      if (usedRecentFallback) {
        const fallbackFilter: any = {};
        if (category) {
          fallbackFilter.businessCategory = category as string;
        }

        const recentProfiles = await prisma.profile.findMany({
          where: fallbackFilter,
          orderBy: {
            id: "desc",
          },
          take: 10,
          include: {
            reviews: true,
          },
        });

        profiles = recentProfiles.map((profile) => {
          const avg =
            profile.reviews.length > 0
              ? profile.reviews.reduce((acc, curr) => acc + curr.rating, 0) /
                profile.reviews.length
              : 5.0;
          return {
            id: -profile.userId,
            name: profile.displayName || profile.fullName,
            category: profile.businessCategory,
            imagePath: profile.imagePath || null,
            location: profile.location || "",
            latitude: profile.latitude,
            longitude: profile.longitude,
            rating: avg,
            contact: profile.whatsAppNumber || profile.mobileNumber || "",
            createdAt: new Date(),
            distance: null,
            averageRating: Number(avg.toFixed(1)),
            totalReviews: profile.reviews.length,
            isSellerProfile: true,
            isRecentFallback: true,
          };
        });
      }

      const combined = [...mappedStores, ...profiles];

      if (hasCoordinates) {
        combined.sort((a, b) => {
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
        return res.json(combined.slice(startIndex, endIndex));
      } else {
        return res.json(combined);
      }
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get a specific store's detail
  static async getStoreById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { lat, lng } = req.query;

      if (id < 0) {
        const userId = Math.abs(id);
        const profile = await prisma.profile.findUnique({
          where: { userId },
          include: {
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
        if (!profile) {
          return res.status(404).json({ error: "Seller profile not found" });
        }

        const userLat = parseFloat(lat as string);
        const userLng = parseFloat(lng as string);
        let distance: number | null = null;
        if (
          !isNaN(userLat) &&
          !isNaN(userLng) &&
          profile.latitude &&
          profile.longitude
        ) {
          distance = calculateDistance(
            userLat,
            userLng,
            profile.latitude,
            profile.longitude
          );
        }

        const relatedListings = await prisma.listing.findMany({
          where: {
            sellerId: userId,
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
          profile.reviews.length > 0
            ? profile.reviews.reduce((acc, curr) => acc + curr.rating, 0) /
              profile.reviews.length
            : 5.0;

        const enrichedStore = {
          id: -profile.userId,
          name: profile.displayName || profile.fullName,
          category: profile.businessCategory,
          imagePath: profile.imagePath || null,
          location: profile.location || "",
          latitude: profile.latitude,
          longitude: profile.longitude,
          rating: avg,
          contact: profile.whatsAppNumber || profile.mobileNumber || "",
          about: profile.aboutSeller,
          professionalTitle: profile.professionalTitle,
          yearsOfExperience: profile.yearsOfExperience,
          email: profile.email,
          distance,
          averageRating: Number(avg.toFixed(1)),
          totalReviews: profile.reviews.length,
          reviews: profile.reviews,
          isSellerProfile: true,
        };

        return res.json({ store: enrichedStore, relatedListings });
      }

      const store = await prisma.store.findUnique({
        where: { id },
        include: {
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
      if (!store) return res.status(404).json({ error: "Store not found" });

      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);
      let distance: number | null = null;
      if (
        !isNaN(userLat) &&
        !isNaN(userLng) &&
        store.latitude &&
        store.longitude
      ) {
        distance = calculateDistance(
          userLat,
          userLng,
          store.latitude,
          store.longitude
        );
      }

      const relatedListings = await prisma.listing.findMany({
        where: {
          location: { contains: store.location, mode: "insensitive" },
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
        store.reviews.length > 0
          ? store.reviews.reduce((acc, curr) => acc + curr.rating, 0) /
            store.reviews.length
          : store.rating;

      const enrichedStore = {
        ...store,
        distance,
        averageRating: Number(avg.toFixed(1)),
        totalReviews: store.reviews.length,
        isSellerProfile: false,
      };

      return res.json({ store: enrichedStore, relatedListings });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Create Store
  static async createStore(req: Request, res: Response) {
    try {
      const {
        name,
        category,
        location,
        latitude,
        longitude,
        rating,
        contact,
        imagePath,
      } = req.body;
      if (!name)
        return res.status(400).json({ error: "Store name is required." });
      if (!category)
        return res.status(400).json({ error: "Store category is required." });
      if (!location)
        return res.status(400).json({ error: "Store location is required." });

      const newStore = await prisma.store.create({
        data: {
          name,
          category,
          imagePath: imagePath || null,
          location,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          rating: rating ? parseFloat(rating) : 5.0,
          contact: contact || null,
        },
      });
      return res.status(201).json(newStore);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Update Store
  static async updateStore(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const {
        name,
        category,
        location,
        latitude,
        longitude,
        rating,
        contact,
        imagePath,
      } = req.body;
      if (!name)
        return res.status(400).json({ error: "Store name is required." });
      if (!category)
        return res.status(400).json({ error: "Store category is required." });
      if (!location)
        return res.status(400).json({ error: "Store location is required." });

      const updateData: any = {
        name,
        category,
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

      const updatedStore = await prisma.store.update({
        where: { id },
        data: updateData,
      });
      return res.json(updatedStore);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete Store
  static async deleteStore(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      await prisma.store.delete({ where: { id } });
      return res.json({ message: "Store deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Add a review to a store
  static async addStoreReview(req: AuthenticatedRequest, res: Response) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { rating, comment } = req.body;
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const buyerId = req.user.id;

      if (!rating || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ error: "Rating must be between 1 and 5" });
      }

      if (id < 0) {
        const userId = Math.abs(id);
        const profile = await prisma.profile.findUnique({
          where: { userId },
        });
        if (!profile)
          return res.status(404).json({ error: "Seller profile not found" });

        const newReview = await prisma.review.create({
          data: {
            profileId: profile.id,
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
      }

      const newReview = await prisma.review.create({
        data: {
          storeId: id,
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

      const allReviews = await prisma.review.findMany({
        where: { storeId: id },
      });
      const avgRating =
        allReviews.reduce((acc, curr) => acc + curr.rating, 0) /
        allReviews.length;
      await prisma.store.update({
        where: { id },
        data: { rating: parseFloat(avgRating.toFixed(1)) },
      });

      return res.status(201).json(newReview);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
