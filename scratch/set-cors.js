const { S3Client, PutBucketCorsCommand } = require("@aws-sdk/client-s3");
const fs = require('fs');
const path = require('path');

// Manually parse .env file
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value.trim();
  }
});

const accountId = env.R2_ACCOUNT_ID;
const accessKeyId = env.R2_ACCESS_KEY_ID;
const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
const bucket = env.R2_BUCKET || "lowpriceplaces";

const s3Client = new S3Client({
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  region: "auto",
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
  forcePathStyle: true,
});

async function run() {
  console.log("Setting CORS on R2 bucket:", bucket);
  try {
    const command = new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: [
              "http://localhost:3000",
              "http://localhost:5173",
              "http://127.0.0.1:3000",
              "http://localhost:5000",
              "http://127.0.0.1:5000"
            ],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600
          }
        ]
      }
    });
    await s3Client.send(command);
    console.log("CORS configuration applied successfully to R2 bucket!");
  } catch (err) {
    console.error("Failed to set CORS:", err);
  }
}

run();
