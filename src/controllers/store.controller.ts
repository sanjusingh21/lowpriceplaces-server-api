import { S3Service } from "../services/s3.service";
import { Request, Response } from "express";
import { prisma } from "../config/db";
import { calculateDistance } from "../utils/distance";
import { AuthenticatedRequest } from "../middlewares/auth";
import { queryCache } from "../utils/cache.util";

export class StoreController {
  // Get nearby stores (filtered by category, sorted by distance)
  static async getStores(req: Request, res: Response) {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const { lat, lng, category, page, limit, location } = req.query;

      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);
      const hasCoordinates = !isNaN(userLat) && !isNaN(userLng);

      // 1. Fetch static stores
      const storeFilter: any = {};
      if (category) {
        storeFilter.category = { contains: category as string, mode: "insensitive" };
      }
      const stores = await prisma.store.findMany({
        where: storeFilter,
        include: { reviews: true },
      });

      const mappedStores = stores.map((store) => {
        let distance: number | null = null;
        if (hasCoordinates && store.latitude && store.longitude) {
          distance = calculateDistance(userLat, userLng, store.latitude, store.longitude);
        }
        const avg = store.reviews.length > 0
          ? store.reviews.reduce((acc, curr) => acc + curr.rating, 0) / store.reviews.length
          : store.rating;
        return {
          id: store.id,
          name: store.name,
          category: store.category,
          imagePath: store.imagePath,
          location: store.location,
          latitude: store.latitude,
          longitude: store.longitude,
          rating: avg,
          contact: store.contact || "",
          distance,
          averageRating: Number(avg.toFixed(1)),
          totalReviews: store.reviews.length,
          isSellerProfile: false,
          createdAt: store.createdAt || new Date(),
        };
      });

      // 2. Fetch profiles where isStore is true and category is valid
      const profileFilter: any = {
        isStore: true,
        businessCategory: { notIn: ["", "General", "None"] },
      };
      if (category) {
        profileFilter.businessCategory = { contains: category as string, mode: "insensitive" };
      }
      const profilesData = await prisma.profile.findMany({
        where: profileFilter,
        include: { reviews: true },
      });

      const mappedProfiles = profilesData.map((profile) => {
        let distance: number | null = null;
        if (hasCoordinates && profile.latitude && profile.longitude) {
          distance = calculateDistance(userLat, userLng, profile.latitude, profile.longitude);
        }
        const avg = profile.reviews.length > 0
          ? profile.reviews.reduce((acc, curr) => acc + curr.rating, 0) / profile.reviews.length
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

      // 3. Fetch listings under category 39 ("All stores")
      const listings = await prisma.listing.findMany({
        where: {
          categoryId: 39,
          status: "ACTIVE",
          ...(category ? {
            OR: [
              { category: { name: { contains: category as string, mode: "insensitive" } } },
              { subCategory: { name: { contains: category as string, mode: "insensitive" } } }
            ]
          } : {})
        },
        include: {
          category: true,
          subCategory: true,
          reviews: true
        }
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
          category: l.subCategory?.name || l.category?.name || "Store",
          imagePath: firstImage,
          location: l.location,
          latitude: l.latitude,
          longitude: l.longitude,
          rating: avg,
          contact: l.whatsappNumber || l.contactNumber || "",
          createdAt: l.createdAt,
          distance,
          averageRating: Number(avg.toFixed(1)),
          totalReviews: l.reviews.length,
          isSellerProfile: false,
          isListing: true
        };
      });

      // Combine all sources
      const combined = [...mappedStores, ...mappedProfiles, ...mappedListings];

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
              // Nationwide fallback (all results)
              localMatches = combined;
            }
          } else {
            // Nationwide fallback (all results)
            localMatches = combined;
          }
        }
        finalResults = localMatches;
      }

      // Proximity sorting if coordinates are present
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

  // Get a specific store's detail
  static async getStoreById(req: Request, res: Response) {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const id = parseInt(req.params.id as string, 10);
      const { lat, lng } = req.query;

      if (id < 0) {
        const userId = Math.abs(id);
        const profile = await prisma.profile.findFirst({
          where: { userId, isStore: true },
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
          return res.status(404).json({ error: "Seller profile store not found" });
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

      let store = await prisma.store.findUnique({
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

      let mappedStore: any = null;
      let relatedListings: any[] = [];
      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);

      if (!store) {
        // Fallback: search listings under category 39 ("All stores")
        const listing = await prisma.listing.findUnique({
          where: { id },
          include: {
            category: true,
            subCategory: true,
            reviews: {
              include: {
                buyer: { select: { username: true } },
              },
              orderBy: { createdAt: "desc" },
            },
            seller: {
              select: {
                id: true,
                username: true,
                profile: true,
              },
            },
          },
        });

        if (!listing) {
          return res.status(404).json({ error: "Store not found" });
        }

        const avg = listing.reviews.length > 0
          ? listing.reviews.reduce((acc, curr) => acc + curr.rating, 0) / listing.reviews.length
          : 5.0;

        let firstImage: string | null = null;
        if (listing.imagePath) {
          const parts = listing.imagePath.split(",");
          if (parts.length > 0) {
            firstImage = parts[0].trim();
          }
        }

        mappedStore = {
          id: listing.id,
          name: listing.title,
          category: listing.subCategory?.name || listing.category?.name || "Store",
          imagePath: firstImage,
          location: listing.location,
          latitude: listing.latitude,
          longitude: listing.longitude,
          rating: avg,
          contact: listing.whatsappNumber || listing.contactNumber || "",
          about: listing.description,
          averageRating: Number(avg.toFixed(1)),
          totalReviews: listing.reviews.length,
          reviews: listing.reviews,
          isSellerProfile: false,
          isListing: true,
          sellerId: listing.sellerId,
        };

        // Query related store listings
        relatedListings = await prisma.listing.findMany({
          where: {
            categoryId: 39,
            status: "ACTIVE",
            id: { not: listing.id },
          },
          include: {
            category: true,
            subCategory: true,
            reviews: { select: { rating: true } },
          },
          take: 6,
        });
      } else {
        const s = store!;
        const avg = s.reviews.length > 0
          ? s.reviews.reduce((acc, curr) => acc + curr.rating, 0) / s.reviews.length
          : s.rating;

        mappedStore = {
          ...s,
          rating: avg,
          averageRating: Number(avg.toFixed(1)),
          totalReviews: s.reviews.length,
          reviews: s.reviews,
          isSellerProfile: false,
        };

        relatedListings = await prisma.listing.findMany({
          where: {
            location: { contains: s.location, mode: "insensitive" },
            status: "ACTIVE",
          },
          include: {
            category: true,
            subCategory: true,
            reviews: { select: { rating: true } },
          },
          take: 6,
        });
      }

      let distance: number | null = null;
      if (
        !isNaN(userLat) &&
        !isNaN(userLng) &&
        mappedStore.latitude &&
        mappedStore.longitude
      ) {
        distance = calculateDistance(
          userLat,
          userLng,
          mappedStore.latitude,
          mappedStore.longitude
        );
      }
      mappedStore.distance = distance;

      return res.json({ store: mappedStore, relatedListings });
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

  // Delete Store safely with verification logging (handles Static Stores, Seller Profiles, and Category 39 Store Listings)
  static async deleteStore(req: Request, res: Response) {
    const rawId = req.params.id as string;
    console.log(`🔍 [DELETE STORE API] Received deletion request for store ID: ${rawId}`);
    try {
      queryCache.clear();
      const id = parseInt(rawId, 10);
      if (isNaN(id)) {
        console.warn(`⚠️ [DELETE STORE API] Invalid store ID format: ${rawId}`);
        return res.status(400).json({ error: "Invalid store ID format." });
      }

      // Case A: Seller Profile Store (negative ID: id = -userId)
      if (id < 0) {
        const userId = Math.abs(id);
        console.log(`🧹 [DELETE STORE API] Deactivating seller store profile for userId: ${userId}`);
        const profile = await prisma.profile.findUnique({ where: { userId } });
        if (!profile) {
          console.log(`ℹ️ [DELETE STORE API] Profile for userId ${userId} does not exist.`);
          return res.status(200).json({ message: "Seller profile store already removed or does not exist." });
        }

        // Cleanly deactivate store profile and reset store metadata
        await prisma.profile.update({
          where: { userId },
          data: {
            isStore: false,
            businessCategory: "",
            businessType: null,
            aboutSeller: "",
          },
        });

        // Verification check
        const checkProfile = await prisma.profile.findUnique({ where: { userId } });
        console.log(`✅ [DELETE STORE API SUCCESS] Verified userId ${userId} isStore status: ${checkProfile?.isStore}`);
        return res.status(200).json({ message: "Seller profile store removed successfully." });
      }

      // Case B: Static Store in Store table
      const staticStore = await prisma.store.findUnique({
        where: { id },
        include: { _count: { select: { reviews: true } } },
      });

      if (staticStore) {
        console.log(`🗑️ [DELETE STORE API] Hard deleting static store ID ${id} ("${staticStore.name}")`);
        await prisma.$transaction(async (tx) => {
          if (staticStore._count.reviews > 0) {
            await tx.review.deleteMany({ where: { storeId: id } });
          }
          await tx.store.delete({ where: { id } });
        });

        // Verification check
        const verifyStore = await prisma.store.findUnique({ where: { id } });
        console.log(`✅ [DELETE STORE API SUCCESS] Verified static store ID ${id} deleted from DB: ${verifyStore === null}`);

        // Async S3 cleanup
        if (staticStore.imagePath && staticStore.imagePath.includes("/api/media/view/")) {
          try {
            const oldKey = staticStore.imagePath.split("/api/media/view/")[1];
            if (oldKey) {
              S3Service.deleteObject(oldKey).catch((s3Err: any) =>
                console.warn(`⚠️ [DELETE STORE API] S3 cleanup warning:`, s3Err.message)
              );
            }
          } catch (cleanupErr) {
            console.warn("⚠️ [DELETE STORE API] Image key parsing error:", cleanupErr);
          }
        }

        return res.status(200).json({ message: "Store deleted successfully." });
      }

      // Case C: Category 39 Store Listing
      const storeListing = await prisma.listing.findUnique({ where: { id } });
      if (storeListing) {
        console.log(`🗑️ [DELETE STORE API] Hard deleting Category 39 store listing ID ${id} ("${storeListing.title}")`);
        await prisma.$transaction(async (tx) => {
          await tx.review.deleteMany({ where: { listingId: id } });
          await tx.inquiry.deleteMany({ where: { listingId: id } });
          await tx.listing.delete({ where: { id } });
        });

        // Verification check
        const verifyListing = await prisma.listing.findUnique({ where: { id } });
        console.log(`✅ [DELETE STORE API SUCCESS] Verified store listing ID ${id} deleted from DB: ${verifyListing === null}`);
        return res.status(200).json({ message: "Store listing deleted successfully." });
      }

      // Record does not exist in any store representation
      console.log(`ℹ️ [DELETE STORE API] Store ID ${id} not found in any store records.`);
      return res.status(200).json({ message: "Store deleted or removed successfully." });
    } catch (error: any) {
      console.error(`❌ [DELETE STORE API ERROR] Failed to delete store ID ${rawId}:`, error);

      if (error.code === "P2025" || error.message?.includes("Record to delete does not exist") || error.message?.includes("required but not found")) {
        return res.status(200).json({ message: "Store deleted or removed successfully." });
      }
      if (error.code === "P2003") {
        return res.status(400).json({
          error: "This store cannot be deleted because it has active related records.",
        });
      }
      return res.status(500).json({ error: error.message || "Failed to delete store." });
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
