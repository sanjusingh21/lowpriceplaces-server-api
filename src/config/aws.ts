import { S3Client } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.warn("WARNING: Cloudflare R2 credentials are not fully configured in environment variables.");
}

export const s3Client = new S3Client({
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  region: "auto",
  credentials: {
    accessKeyId: accessKeyId || "",
    secretAccessKey: secretAccessKey || "",
  },
  forcePathStyle: true,
});

export const bucketName = process.env.R2_BUCKET || "lowpriceplaces";
