import { Request, Response } from "express";
import { prisma } from "../config/db";
import { calculateDistance } from "../utils/distance";
import { queryCache } from "../utils/cache.util";
import { scoreAndFilterItems } from "../utils/searchEngine";

export class SearchController {
  static async searchGlobal(req: Request, res: Response) {
    try {
      const q = (req.query.q as string || "").trim();
      const location = (req.query.location as string || "").trim();
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : null;
      const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : null;
      const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : null;
      const rating = req.query.rating ? parseFloat(req.query.rating as string) : null;
      const sortBy = (req.query.sortBy as string || "relevance").trim();
      const tab = (req.query.tab as string || "all").trim().toLowerCase();
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 12;
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);

      const cacheKey = `search_v9_strict_filtered:${q.toLowerCase()}:${location.toLowerCase()}:${categoryId}:${minPrice}:${maxPrice}:${rating}:${sortBy}:${tab}:${page}:${limit}:${lat}:${lng}`;
      const cached = queryCache.get<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const hasCoords = !isNaN(lat) && !isNaN(lng);

      // 1. Products (Listings excluding SERVICES)
      const productFilter: any = {
        status: "ACTIVE",
        listingType: { not: "SERVICES" }
      };
      if (location) {
        productFilter.location = { contains: location, mode: "insensitive" };
      }
      if (categoryId) {
        productFilter.categoryId = categoryId;
      }
      if (minPrice !== null || maxPrice !== null) {
        productFilter.price = {};
        if (minPrice !== null) productFilter.price.gte = minPrice;
        if (maxPrice !== null) productFilter.price.lte = maxPrice;
      }

      // 2. Service Listings
      const serviceListingFilter: any = {
        status: "ACTIVE",
        listingType: "SERVICES"
      };
      if (location) {
        serviceListingFilter.location = { contains: location, mode: "insensitive" };
      }
      if (categoryId) {
        serviceListingFilter.categoryId = categoryId;
      }
      if (minPrice !== null || maxPrice !== null) {
        serviceListingFilter.price = {};
        if (minPrice !== null) serviceListingFilter.price.gte = minPrice;
        if (maxPrice !== null) serviceListingFilter.price.lte = maxPrice;
      }

      // 3. Stores
      const storeFilter: any = {};
      if (location) {
        storeFilter.location = { contains: location, mode: "insensitive" };
      }

      // If q is specified, add DB-level contains matching
      if (q) {
        const qCondition = {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { category: { name: { contains: q, mode: "insensitive" } } },
            { subCategory: { name: { contains: q, mode: "insensitive" } } }
          ]
        };
        productFilter.AND = productFilter.AND ? [...productFilter.AND, qCondition] : [qCondition];
        serviceListingFilter.AND = serviceListingFilter.AND ? [...serviceListingFilter.AND, qCondition] : [qCondition];
        storeFilter.OR = [
          { name: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
          { location: { contains: q, mode: "insensitive" } }
        ];
      }

      // Database Fetches
      const [dbProducts, dbServiceListings, dbStores] = await Promise.all([
        prisma.listing.findMany({ where: productFilter, include: { category: true, subCategory: true, reviews: true } }),
        prisma.listing.findMany({ where: serviceListingFilter, include: { category: true, subCategory: true, reviews: true } }),
        prisma.store.findMany({ where: storeFilter, include: { reviews: true } })
      ]);

      const rawProducts = dbProducts.map(p => {
        const avg = p.reviews.length > 0
          ? p.reviews.reduce((acc, curr) => acc + curr.rating, 0) / p.reviews.length
          : 5.0;
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          category: p.category?.name || "Products",
          subCategory: p.subCategory?.name || "",
          price: p.price,
          priceMax: p.priceMax,
          discountPercent: p.discountPercent,
          location: p.location,
          latitude: p.latitude,
          longitude: p.longitude,
          imagePath: p.imagePath?.split(",")[0] || null,
          type: "product",
          rating: avg,
          totalReviews: p.reviews.length,
          createdAt: p.createdAt,
          distance: hasCoords && p.latitude && p.longitude ? calculateDistance(lat, lng, p.latitude, p.longitude) : null
        };
      });

      const rawServices = dbServiceListings.map(s => {
        const avg = s.reviews.length > 0
          ? s.reviews.reduce((acc, curr) => acc + curr.rating, 0) / s.reviews.length
          : 5.0;
        return {
          id: s.id,
          title: s.title,
          description: s.description,
          category: s.category?.name || "Services",
          subCategory: s.subCategory?.name || "",
          serviceType: s.category?.name || "Services",
          price: s.price,
          priceMax: s.priceMax,
          discountPercent: s.discountPercent,
          location: s.location,
          latitude: s.latitude,
          longitude: s.longitude,
          imagePath: s.imagePath?.split(",")[0] || null,
          type: "service",
          rating: avg,
          totalReviews: s.reviews.length,
          createdAt: s.createdAt,
          distance: hasCoords && s.latitude && s.longitude ? calculateDistance(lat, lng, s.latitude, s.longitude) : null
        };
      });

      const rawStores = dbStores.map(st => {
        const avg = st.reviews.length > 0
          ? st.reviews.reduce((acc, curr) => acc + curr.rating, 0) / st.reviews.length
          : st.rating || 5.0;
        return {
          id: st.id,
          title: st.name,
          description: `Category: ${st.category} | Contact: ${st.contact || 'N/A'}`,
          category: st.category,
          price: 0,
          location: st.location,
          latitude: st.latitude,
          longitude: st.longitude,
          imagePath: st.imagePath || null,
          type: "store",
          rating: avg,
          totalReviews: st.reviews.length,
          createdAt: st.createdAt,
          distance: hasCoords && st.latitude && st.longitude ? calculateDistance(lat, lng, st.latitude, st.longitude) : null
        };
      });

      const allListings = [...rawProducts, ...rawServices, ...rawStores];

      let scoredListings = q 
        ? scoreAndFilterItems(q, allListings)
        : allListings.map(item => ({ item, score: 100, matchReason: "default", isDirectMatch: true }));

      if (rating !== null) {
        scoredListings = scoredListings.filter(r => r.item.rating >= rating);
      }

      // Primary sort MUST ALWAYS prioritize relevance score descending so exact title matches (e.g. godown) rank #1
      scoredListings.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (sortBy === "price_asc") return a.item.price - b.item.price;
        if (sortBy === "price_desc") return b.item.price - a.item.price;
        if (sortBy === "newest") return new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime();
        if (sortBy === "rating_desc") return b.item.rating - a.item.rating;
        return 0;
      });

      const allMappedResults = scoredListings.map(r => ({
        ...r.item,
        isDirectMatch: r.isDirectMatch,
        relevanceScore: r.score,
        matchReason: r.matchReason
      }));

      // Compute counts per tab
      const counts = {
        all: allMappedResults.length,
        products: allMappedResults.filter(i => i.type === "product").length,
        services: allMappedResults.filter(i => i.type === "service").length,
        stores: allMappedResults.filter(i => i.type === "store").length,
      };

      // Filter results according to requested tab
      let tabFilteredResults = allMappedResults;
      if (tab === "products") {
        tabFilteredResults = allMappedResults.filter(i => i.type === "product");
      } else if (tab === "services") {
        tabFilteredResults = allMappedResults.filter(i => i.type === "service");
      } else if (tab === "stores") {
        tabFilteredResults = allMappedResults.filter(i => i.type === "store");
      }

      const totalResults = tabFilteredResults.length;
      const startIndex = (page - 1) * limit;
      const paginatedResults = tabFilteredResults.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < totalResults;

      const responsePayload = {
        counts,
        results: paginatedResults,
        totalResults,
        page,
        hasMore
      };

      queryCache.set(cacheKey, responsePayload, 30000);
      return res.json(responsePayload);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
