import { prisma } from "../config/db";
import { S3Service } from "../services/s3.service";
import { bucketName } from "../config/aws";

export async function promoteListingImages(imagePath: string | null | undefined): Promise<void> {
  if (!imagePath) return;
  try {
    const urls = imagePath.split(",");
    for (const url of urls) {
      let key: string | null = null;
      const viewPrefix = "/api/media/view/";
      const viewIdx = url.indexOf(viewPrefix);
      if (viewIdx !== -1) {
        key = url.substring(viewIdx + viewPrefix.length);
      } else {
        const s3UrlPattern = new RegExp(
          `https://${bucketName}\\.s3\\.amazonaws\\.com/(.+)`
        );
        const match = url.match(s3UrlPattern);
        if (match) {
          key = match[1];
        }
      }

      if (key) {
        // 1. Update status in Database to COMMITTED
        await prisma.media.updateMany({
          where: { key },
          data: {
            status: "COMMITTED",
          },
        });

        // 2. Call S3 to update Tag to Status=Committed
        await S3Service.promoteObject(key);
      }
    }
  } catch (err) {
    console.error("Failed to promote listing S3 objects:", err);
  }
}
