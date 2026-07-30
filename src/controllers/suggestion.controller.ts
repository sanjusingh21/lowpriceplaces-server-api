import { Request, Response } from "express";
import { prisma } from "../config/db";

export class SuggestionController {
  static async getSuggestions(req: Request, res: Response) {
    try {
      const q = (req.query.q as string || "").trim();
      if (!q || q.length < 2) {
        return res.json([]);
      }

      const queryLower = q.toLowerCase();

      // Query database for matching titles/names in parallel
      const [listings, stores, services, categories, subCategories] = await Promise.all([
        prisma.listing.findMany({
          where: {
            title: { contains: q, mode: "insensitive" },
            status: "ACTIVE"
          },
          select: { title: true },
          take: 5
        }),
        prisma.store.findMany({
          where: { name: { contains: q, mode: "insensitive" } },
          select: { name: true },
          take: 5
        }),
        prisma.service.findMany({
          where: { name: { contains: q, mode: "insensitive" } },
          select: { name: true },
          take: 5
        }),
        prisma.category.findMany({
          where: { name: { contains: q, mode: "insensitive" } },
          select: { name: true },
          take: 5
        }),
        prisma.subCategory.findMany({
          where: { name: { contains: q, mode: "insensitive" } },
          select: { name: true },
          take: 5
        })
      ]);

      // Combine suggestions
      const rawSuggestions = [
        ...listings.map(l => ({ label: l.title, type: "listing" })),
        ...stores.map(s => ({ label: s.name, type: "store" })),
        ...services.map(s => ({ label: s.name, type: "service" })),
        ...categories.map(c => ({ label: c.name, type: "category" })),
        ...subCategories.map(s => ({ label: s.name, type: "subcategory" }))
      ];

      // Deduplicate suggestions case-insensitively
      const seen = new Set<string>();
      const uniqueSuggestions: typeof rawSuggestions = [];

      // Always include domain search suggestion "lowpriceplaces.com" if query matches domain terms
      const domainMatch = "lowpriceplaces.com";
      const domainTerms = ["low", "lowp", "price", "places", "lowpriceplaces"];
      const isDomainMatch = domainTerms.some(term => term.includes(queryLower) || queryLower.includes(term));
      
      if (isDomainMatch) {
        uniqueSuggestions.push({ label: domainMatch, type: "website" });
        seen.add(domainMatch.toLowerCase());
      }

      for (const item of rawSuggestions) {
        const lower = item.label.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          uniqueSuggestions.push(item);
        }
      }

      // Sort by relevance:
      // 1. Exact match first
      // 2. Starts with query next
      // 3. Contains query next
      uniqueSuggestions.sort((a, b) => {
        const aText = a.label.toLowerCase();
        const bText = b.label.toLowerCase();

        const aExact = aText === queryLower;
        const bExact = bText === queryLower;
        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;

        const aStart = aText.startsWith(queryLower);
        const bStart = bText.startsWith(queryLower);
        if (aStart && !bStart) return -1;
        if (bStart && !aStart) return 1;

        return aText.localeCompare(bText);
      });

      // Limit to 8 suggestions
      return res.json(uniqueSuggestions.slice(0, 8));
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
