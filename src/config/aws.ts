import { S3Client } from "@aws-sdk/client-s3";

const awsRegion = process.env.AWS_REGION || "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!accessKeyId || !secretAccessKey) {
  console.warn("WARNING: AWS S3 credentials are not fully configured in environment variables.");
}

export const s3Client = new S3Client({
  region: awsRegion,
  credentials: {
    accessKeyId: accessKeyId || "",
    secretAccessKey: secretAccessKey || "",
  },
});

export const bucketName = process.env.AWS_S3_BUCKET || "lowpriceplaces-media";
