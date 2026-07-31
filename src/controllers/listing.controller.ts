import { Request, Response } from "express";
import { prisma } from "../config/db";
import { calculateDistance } from "../utils/distance";
import { promoteListingImages } from "../utils/s3Promoter";
import { AuthenticatedRequest } from "../middlewares/auth";
import { refreshCityListingCount } from "../utils/cityCounter";

function titleCase(str: string): string {
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

async function resolveOrCreateLocality(locationStr: string): Promise<number | null> {
  if (!locationStr) return null;

  const BLOCKED_POI_KEYWORDS = [
    "station", "stop", "bus", "metro", "railway",
    "mall", "shopping", "center", "centre", "plaza", "bazaar",
    "hospital", "clinic", "diagnostic", "health", "medical",
    "school", "college", "university", "academy", "institute",
    "temple", "mosque", "masjid", "church", "gurudwara", "ashram", "shrine",
    "building", "apartment", "residency", "tower", "villa", "house", "complex", "society",
    "road", "street", "lane", "highway", "bypass", "flyover", "chowk", "gali"
  ];

  const parts = locationStr.split(",")
    .map(p => p.trim())
    .filter(p => {
      if (!p) return false;
      const lower = p.toLowerCase();
      return !BLOCKED_POI_KEYWORDS.some(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        return regex.test(lower);
      });
    });

  let locality = "";
  let parentCity = "";
  let state: string | null = null;

  if (parts.length >= 3) {
    locality = titleCase(parts[0]);
    parentCity = titleCase(parts[1]);
    state = titleCase(parts[2]);
  } else if (parts.length === 2) {
    locality = titleCase(parts[0]);
    parentCity = titleCase(parts[1]);
  } else if (parts.length === 1 && parts[0]) {
    locality = titleCase(parts[0]);
  }

  if (!locality) return null;

  const normParent = (parentCity === "null" || !parentCity) ? "" : parentCity;

  const existing = await prisma.city.findFirst({
    where: {
      name: { equals: locality, mode: "insensitive" },
      parentCity: { equals: normParent, mode: "insensitive" }
    }
  });

  if (existing) {
    return existing.id;
  }

  const newCity = await prisma.city.create({
    data: {
      name: locality,
      parentCity: normParent,
      state: state || null,
    }
  });
  return newCity.id;
}

export class ListingController {
  // Get listings with filters, search, and pagination
  static async getListings(req: Request, res: Response) {
    try {
      const {
        q,
        categoryId,
        subCategoryId,
        cityId,
        subCityId,
        minPrice,
        maxPrice,
        location,
        status,
        discountOnly,
        sellerId,
        dateFilter,
        sortBy,
        lat,
        lng,
        listingType,
        ids,
      } = req.query;

      const filters: any = {};

      if (ids) {
        const idArray = (ids as string)
          .split(",")
          .map((id) => parseInt(id))
          .filter((id) => !isNaN(id));
        filters.id = { in: idArray };
      }

      if (sellerId) {
        filters.sellerId = parseInt(sellerId as string);
      }

      if (listingType) {
        filters.listingType = listingType as string;
      }

      if (status && status !== "ALL") {
        filters.status = status as string;
      } else if (!status) {
        filters.status = "ACTIVE";
      }

      if (categoryId) {
        filters.categoryId = parseInt(categoryId as string);
      }
      if (subCategoryId) {
        filters.subCategoryId = parseInt(subCategoryId as string);
      }
      if (cityId) {
        filters.cityId = parseInt(cityId as string);
      }
      if (subCityId) {
        filters.subCityId = parseInt(subCityId as string);
      }

      if (minPrice || maxPrice) {
        filters.price = {};
        if (minPrice) filters.price.gte = parseFloat(minPrice as string);
        if (maxPrice) filters.price.lte = parseFloat(maxPrice as string);
      }

      if (location) {
        filters.location = {
          contains: location as string,
          mode: "insensitive",
        };
      }

      if (discountOnly === "true") {
        filters.discountPercent = { gt: 0 };
      }

      if (dateFilter) {
        let start: Date | undefined, end: Date | undefined;
        if (dateFilter === "today") {
          start = new Date();
          start.setHours(0, 0, 0, 0);
          end = new Date();
          end.setHours(23, 59, 59, 999);
        } else if (dateFilter === "yesterday") {
          start = new Date();
          start.setDate(start.getDate() - 1);
          start.setHours(0, 0, 0, 0);
          end = new Date();
          end.setDate(end.getDate() - 1);
          end.setHours(23, 59, 59, 999);
        } else {
          const parsed = Date.parse(dateFilter as string);
          if (!isNaN(parsed)) {
            start = new Date(parsed);
            start.setHours(0, 0, 0, 0);
            end = new Date(parsed);
            end.setHours(23, 59, 59, 999);
          }
        }
        if (start && end) {
          filters.createdAt = {
            gte: start,
            lte: end,
          };
        }
      }

      if (q) {
        const queryStr = q as string;
        filters.OR = [
          { title: { contains: queryStr, mode: "insensitive" } },
          { description: { contains: queryStr, mode: "insensitive" } },
          { category: { name: { contains: queryStr, mode: "insensitive" } } },
          { subCategory: { name: { contains: queryStr, mode: "insensitive" } } },
          { location: { contains: queryStr, mode: "insensitive" } },
        ];

        const cleanIdStr = queryStr.replace(/^LPP-/i, "").trim();
        if (/^\d+$/.test(cleanIdStr)) {
          const numericId = parseInt(cleanIdStr, 10);
          filters.OR.push({ id: numericId });
        }
      }

      let orderOption: any = { createdAt: "desc" };
      if (sortBy === "price_asc") {
        orderOption = { price: "asc" };
      } else if (sortBy === "price_desc") {
        orderOption = { price: "desc" };
      } else if (sortBy === "date_asc") {
        orderOption = { createdAt: "asc" };
      } else if (sortBy === "date_desc") {
        orderOption = { createdAt: "desc" };
      }

      const pageNum = parseInt(req.query.page as string);
      const limitNum = parseInt(req.query.limit as string);
      const hasPagination = !isNaN(pageNum) && !isNaN(limitNum);
      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);
      const isDistanceSort = sortBy === "distance_asc" && !isNaN(userLat) && !isNaN(userLng);

      const findOptions: any = {
        where: filters,
        include: {
          category: true,
          subCategory: true,
          city: true,
          seller: {
            select: { username: true, role: true },
          },
          reviews: {
            select: { rating: true },
          },
          moderatedBy: {
            select: { username: true, role: true },
          },
        },
        orderBy: orderOption,
      };

      if (hasPagination && !isDistanceSort) {
        findOptions.skip = (pageNum - 1) * limitNum;
        findOptions.take = limitNum;
      }

      const listings = await prisma.listing.findMany(findOptions) as any[];

      const enrichedListings = listings.map((l: any) => {
        const avg =
          l.reviews.length > 0
            ? l.reviews.reduce((acc: number, curr: any) => acc + curr.rating, 0) /
              l.reviews.length
            : 0;
        return {
          ...l,
          averageRating: Number(avg.toFixed(1)),
          totalReviews: l.reviews.length,
        };
      });

      let mappedListings = enrichedListings.map((l) => {
        let distance: number | null = null;
        if (!isNaN(userLat) && !isNaN(userLng) && l.latitude && l.longitude) {
          distance = calculateDistance(userLat, userLng, l.latitude, l.longitude);
        }
        return { ...l, distance };
      });

      if (isDistanceSort) {
        mappedListings.sort((a, b) => {
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
        if (hasPagination) {
          const startIndex = (pageNum - 1) * limitNum;
          const endIndex = pageNum * limitNum;
          mappedListings = mappedListings.slice(startIndex, endIndex);
        }
      }

      return res.json(mappedListings);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Create Listing
  static async createListing(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const {
        title,
        description,
        price,
        priceMax,
        listingType,
        discountPercent,
        location,
        latitude,
        longitude,
        whatsappNumber,
        contactNumber,
        categoryId,
        subCategoryId,
        cityId,
        subCityId,
        imageUrls,
        imagePath: providedImagePath,
      } = req.body;

      if (
        !title ||
        !description ||
        !price ||
        !whatsappNumber ||
        !contactNumber ||
        !categoryId
      ) {
        return res.status(400).json({ error: "Required fields are missing." });
      }

      let finalLocation = location || "";
      const resolvedCityId = await resolveOrCreateLocality(finalLocation);

      const imagePath = imageUrls || providedImagePath || null;

      const resolvedListingType = parseInt(categoryId) === 39 ? "SALES" : (listingType || "SALES");

      const listing = await prisma.listing.create({
        data: {
          title,
          description,
          price: parseFloat(price),
          priceMax: priceMax ? parseFloat(priceMax) : null,
          listingType: resolvedListingType,
          discountPercent: parseFloat(discountPercent || 0),
          location: finalLocation,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          cityId: resolvedCityId,
          whatsappNumber,
          contactNumber,
          imagePath,
          sellerId: req.user.id,
          categoryId: parseInt(categoryId),
          subCategoryId: subCategoryId ? parseInt(subCategoryId) : null,
          status:
            req.user.role !== "ADMIN" && req.user.role !== "EDITOR"
              ? "PENDING"
              : "ACTIVE",
        },
      });

      if (listing.status === "ACTIVE") {
        await refreshCityListingCount(listing.cityId);
      }

      const io = req.app.get("io");
      if (io) {
        io.emit("listings_update", { action: "create", listing });
      }

      await promoteListingImages(imagePath);

      return res.status(201).json(listing);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get Listing Details by ID
  static async getListingById(req: Request, res: Response) {
    try {
      const listingId = parseInt(req.params.id as string, 10);

      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        include: {
          category: true,
          subCategory: true,
          city: true,
          seller: {
            select: {
              id: true,
              username: true,
              phoneNumber: true,
              whatsappNumber: true,
              profile: true,
            },
          },
          reviews: {
            include: { buyer: { select: { username: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!listing) return res.status(404).json({ error: "Listing not found." });

      const seo = await prisma.sEOMeta.findUnique({
        where: { routePath: `/listings/${listingId}` },
      });

      const totalRating = listing.reviews.reduce((acc, r) => acc + r.rating, 0);
      const avgRating =
        listing.reviews.length > 0
          ? (totalRating / listing.reviews.length).toFixed(1)
          : 0;

      return res.json({
        ...listing,
        averageRating: Number(avgRating),
        totalReviews: listing.reviews.length,
        seo: seo || {
          titleTag: `${listing.title} - Buy on lowpriceplaces`,
          metaDescription: `${listing.description.substring(0, 150)}... Buy at ${listing.price}$ in ${listing.location}`,
          keywords: `${listing.title.toLowerCase().split(" ").join(", ")}, classifieds`,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Update Listing Status
  static async updateListingStatus(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const listingId = parseInt(req.params.id as string, 10);
      const { status, rejectReason } = req.body;

      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
      });
      if (!listing) return res.status(404).json({ error: "Listing not found" });

      if (req.user.role === "USER" && listing.sellerId !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Forbidden: You do not own this listing." });
      }

      if (req.user.role === "USER" && status !== "SOLD") {
        return res.status(403).json({
          error: "Forbidden: Users can only update status to SOLD.",
        });
      }

      if (status === "REJECTED" && (!rejectReason || !rejectReason.trim())) {
        return res.status(400).json({
          error: "A rejection reason is required when rejecting a listing.",
        });
      }

      const dataUpdate: any = { status };
      if (status === "REJECTED") {
        dataUpdate.rejectReason = rejectReason;
      } else {
        dataUpdate.rejectReason = null;
      }

      if (["ADMIN", "EDITOR"].includes(req.user.role)) {
        dataUpdate.moderatedById = req.user.id;
        dataUpdate.moderatedAt = new Date();
      }

      const updatedListing = await prisma.listing.update({
        where: { id: listingId },
        data: dataUpdate,
      });

      const io = req.app.get("io");
      if (io) {
        io.emit("listings_update", { action: "update", listing: updatedListing });
      }

      await refreshCityListingCount(listing.cityId);
      if (updatedListing.cityId !== listing.cityId) {
        await refreshCityListingCount(updatedListing.cityId);
      }

      return res.json(updatedListing);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Update Listing Details
  static async updateListing(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const listingId = parseInt(req.params.id as string, 10);
      const {
        title,
        description,
        price,
        priceMax,
        listingType,
        discountPercent,
        location,
        latitude,
        longitude,
        whatsappNumber,
        contactNumber,
        categoryId,
        subCategoryId,
        cityId,
        subCityId,
        imageUrls,
        imagePath: providedImagePath,
      } = req.body;

      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
      });
      if (!listing) return res.status(404).json({ error: "Listing not found" });

      if (req.user.role === "USER" && listing.sellerId !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Forbidden: You do not own this listing." });
      }

      let imagePaths = imageUrls !== undefined ? imageUrls : providedImagePath;

      const updatedData: any = {};
      if (imagePaths !== undefined) updatedData.imagePath = imagePaths;
      if (title !== undefined) updatedData.title = title;
      if (description !== undefined) updatedData.description = description;
      if (price !== undefined) updatedData.price = parseFloat(price);
      if (priceMax !== undefined)
        updatedData.priceMax = priceMax ? parseFloat(priceMax) : null;
      if (discountPercent !== undefined)
        updatedData.discountPercent = parseFloat(discountPercent);
      if (location !== undefined) {
        updatedData.location = location;
        const resolvedCityId = await resolveOrCreateLocality(location);
        updatedData.cityId = resolvedCityId;
      }
      if (latitude !== undefined) updatedData.latitude = latitude ? parseFloat(latitude) : null;
      if (longitude !== undefined) updatedData.longitude = longitude ? parseFloat(longitude) : null;

      if (whatsappNumber !== undefined)
        updatedData.whatsappNumber = whatsappNumber;
      if (contactNumber !== undefined)
        updatedData.contactNumber = contactNumber;
      if (categoryId !== undefined)
        updatedData.categoryId = parseInt(categoryId);
      if (subCategoryId !== undefined)
        updatedData.subCategoryId = subCategoryId
          ? parseInt(subCategoryId)
          : null;

      const finalCategoryId = categoryId !== undefined ? parseInt(categoryId) : listing.categoryId;
      if (finalCategoryId === 39) {
        updatedData.listingType = "SALES";
      } else if (listingType !== undefined) {
        updatedData.listingType = listingType;
      }

      if (req.user.role === "USER") {
        updatedData.status = "PENDING";
        updatedData.rejectReason = null;
      }

      const updatedListing = await prisma.listing.update({
        where: { id: listingId },
        data: updatedData,
      });

      const io = req.app.get("io");
      if (io) {
        io.emit("listings_update", { action: "update", listing: updatedListing });
      }

      if (imagePaths) {
        await promoteListingImages(imagePaths);
      }

      await refreshCityListingCount(listing.cityId);
      if (updatedListing.cityId !== listing.cityId) {
        await refreshCityListingCount(updatedListing.cityId);
      }

      return res.json(updatedListing);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Delete Listing
  static async deleteListing(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const listingId = parseInt(req.params.id as string, 10);
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
      });
      if (!listing) return res.status(404).json({ error: "Listing not found" });

      if (
        req.user.role !== "ADMIN" &&
        req.user.role !== "EDITOR" &&
        listing.sellerId !== req.user.id
      ) {
        return res.status(403).json({ error: "Forbidden: Access denied." });
      }

      await prisma.listing.delete({ where: { id: listingId } });

      const io = req.app.get("io");
      if (io) {
        io.emit("listings_update", { action: "delete", id: listingId });
      }

      if (listing.status === "ACTIVE") {
        await refreshCityListingCount(listing.cityId);
      }

      return res.json({ message: "Listing deleted successfully." });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
