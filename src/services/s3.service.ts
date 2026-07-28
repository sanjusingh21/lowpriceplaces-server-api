import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, bucketName } from "../config/aws";

export class S3Service {
  /**
   * Generates a pre-signed URL for uploading a file (PUT method)
   * Expiry: 5 minutes (300 seconds)
   */
  static async getPresignedPutUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType
    });
    return getSignedUrl(s3Client, command, { expiresIn: 300 });
  }

  /**
   * Generates a pre-signed URL for downloading a file (GET method)
   * Expiry: 10 minutes (600 seconds)
   */
  static async getPresignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn: 600 });
  }

  /**
   * Updates S3 object tags (No-op on Cloudflare R2)
   */
  static async promoteObject(key: string): Promise<void> {
    // Cloudflare R2 does not support object tagging.
    return Promise.resolve();
  }

  /**
   * Deletes an object from the S3 bucket
   */
  static async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    await s3Client.send(command);
  }
}
