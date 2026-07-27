import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, PutObjectTaggingCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, bucketName } from "../config/aws";

export class S3Service {
  /**
   * Generates a pre-signed URL for uploading a file (PUT method)
   * Expiry: 5 minutes (300 seconds)
   * Automatically sets a Temporary tag on S3 upload
   */
  static async getPresignedPutUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
      Tagging: "Status=Temporary"
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
   * Updates S3 object tags to mark upload as committed
   */
  static async promoteObject(key: string): Promise<void> {
    const command = new PutObjectTaggingCommand({
      Bucket: bucketName,
      Key: key,
      Tagging: {
        TagSet: [
          {
            Key: "Status",
            Value: "Committed"
          }
        ]
      }
    });
    await s3Client.send(command);
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
