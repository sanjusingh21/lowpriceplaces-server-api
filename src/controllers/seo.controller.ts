import { Request, Response } from "express";
import { prisma } from "../config/db";

export class SeoController {
  // Get SEO Metadata for a Page Route
  static async getSeo(req: Request, res: Response) {
    try {
      const { path: routePath } = req.query;
      if (!routePath) {
        return res.status(400).json({ error: "Query path is required." });
      }

      const seo = await prisma.sEOMeta.findUnique({
        where: { routePath: routePath as string },
      });

      if (!seo) {
        return res.json({ titleTag: "", metaDescription: "", keywords: "" });
      }
      return res.json(seo);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Save/Update SEO Metadata
  static async updateSeo(req: Request, res: Response) {
    try {
      const { routePath, titleTag, metaDescription, keywords } = req.body;
      if (!routePath || !titleTag || !metaDescription) {
        return res.status(400).json({
          error: "routePath, titleTag and metaDescription are required.",
        });
      }

      const seo = await prisma.sEOMeta.upsert({
        where: { routePath },
        update: { titleTag, metaDescription, keywords },
        create: { routePath, titleTag, metaDescription, keywords },
      });

      return res.json(seo);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
