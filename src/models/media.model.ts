import { prisma } from "../config/db";

export interface CreateMediaInput {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  extension: string;
  uploadedBy?: number;
  entityType?: string;
  entityId?: number;
}

export class MediaModel {
  static async create(data: CreateMediaInput) {
    return prisma.media.create({
      data: {
        key: data.key,
        url: data.url,
        mimeType: data.mimeType,
        size: data.size,
        extension: data.extension,
        uploadedBy: data.uploadedBy,
        entityType: data.entityType,
        entityId: data.entityId,
      },
    });
  }

  static async findById(id: string) {
    return prisma.media.findFirst({
      where: {
        id,
        deletedAt: null, // Ignore soft-deleted media
      },
    });
  }

  static async findByKey(key: string) {
    return prisma.media.findFirst({
      where: {
        key,
        deletedAt: null,
      },
    });
  }

  static async softDelete(id: string) {
    return prisma.media.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  static async hardDelete(id: string) {
    return prisma.media.delete({
      where: { id },
    });
  }
}
