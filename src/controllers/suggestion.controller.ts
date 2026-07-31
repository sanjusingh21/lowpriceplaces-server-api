import { Request, Response } from "express";
import { prisma } from "../config/db";
import { queryCache } from "../utils/cache.util";
import { scoreTitleMatch } from "../utils/searchEngine";

export class SuggestionController {
  static async getSuggestions(req: Request, res: Response) {
    try {
      const q = (req.query.q as string || "").trim();
      if (!q || q.length < 2) {
        return res.json([]);
      }

      const cacheKey = `suggestions_v4_titles_only:${q.toLowerCase()}`;
      const cached = queryCache.get<any[]>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const queryLower = q.toLowerCase();

      // Query ONLY active listing titles from database
      const listings = await prisma.listing.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, title: true },
        take: 200
      });

      const candidateMap = new Map<string, { id: number; title: string; score: number }>();

      for (const l of listings) {
        const title = l.title.trim();
        if (!title) continue;

        const score = scoreTitleMatch(q, title);
        if (score > 0) {
          const key = title.toLowerCase();
          const existing = candidateMap.get(key);
          if (!existing || score > existing.score) {
            candidateMap.set(key, { id: l.id, title, score });
          }
        }
      }

      const candidates = Array.from(candidateMap.values());

      // Sort order:
      // 1. Exact title match (score 100 or 95)
      // 2. Title starts with search term (score 90 or 85)
      // 3. Partial title match / Fuzzy match (score 75-30)
      candidates.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.title.localeCompare(b.title);
      });

      // Format response items for client (titles only)
      const suggestions = candidates.slice(0, 10).map(c => ({
        id: c.id,
        title: c.title,
        label: c.title,
        type: "title"
      }));

      queryCache.set(cacheKey, suggestions, 60000); // 60s TTL

      return res.json(suggestions);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
