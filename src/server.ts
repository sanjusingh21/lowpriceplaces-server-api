import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import compression from "compression";
import { prisma } from "./config/db";
import { S3Service } from "./services/s3.service";

import authRoutes from "./routes/auth.routes";
import profileRoutes from "./routes/profile.routes";
import categoryRoutes from "./routes/category.routes";
import subcategoryRoutes from "./routes/subcategory.routes";
import storeRoutes from "./routes/store.routes";
import serviceRoutes from "./routes/service.routes";
import listingRoutes from "./routes/listing.routes";
import reviewRoutes from "./routes/review.routes";
import inquiryRoutes from "./routes/inquiry.routes";
import chatRoutes from "./routes/chat.routes";
import seoRoutes from "./routes/seo.routes";
import userRoutes from "./routes/user.routes";
import adminRoutes from "./routes/admin.routes";
import cityRoutes from "./routes/city.routes";
import mediaRoutes from "./routes/media.routes";
import suggestionRoutes from "./routes/suggestion.routes";
import { syncAllCityListingCounts } from "./utils/cityCounter";

const app = express();
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Socket.io Connection Handlers
io.on("connection", (socket) => {
  socket.on("join_room", (inquiryId: string | number) => {
    if (inquiryId) {
      socket.join(`inquiry_${inquiryId}`);
    }
  });

  socket.on("send_message", (data: { inquiryId?: string | number }) => {
    if (data && data.inquiryId) {
      io.to(`inquiry_${data.inquiryId}`).emit("receive_message", data);
    }
  });
});

// Attach socket.io to express app for access in controllers
app.set("io", io);

const PORT = process.env.PORT || 5000;

// Express Middlewares
app.use(cors());
app.use(compression());
app.use(express.json());

// Background Cleanup: Hourly cleanup of uncommitted database metadata records older than 24 hours
setInterval(
  async () => {
    try {
      const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const orphanedMedia = await prisma.media.findMany({
        where: {
          status: "UNCOMMITTED",
          createdAt: { lt: threshold },
        },
      });

      for (const item of orphanedMedia) {
        try {
          await S3Service.deleteObject(item.key);
        } catch (r2Error) {
          console.error(
            `[Lifecycle Cleanup] Failed to delete orphaned R2 object: ${item.key}`,
            r2Error,
          );
        }
      }

      const deletedCount = await prisma.media.deleteMany({
        where: {
          status: "UNCOMMITTED",
          createdAt: { lt: threshold },
        },
      });
      if (deletedCount.count > 0) {
        console.log(
          `[Lifecycle Cleanup] Cleaned up ${deletedCount.count} expired uncommitted media records from database and R2 storage.`,
        );
      }
    } catch (err) {
      console.error(
        "[Lifecycle Cleanup] Error running database media cleanup:",
        err,
      );
    }
  },
  4 * 60 * 60 * 1000,
);

// --- MVC ROUTER MOUNTING ---
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/subcategories", subcategoryRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/inquiries", inquiryRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/seo", seoRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/cities", cityRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/suggestions", suggestionRoutes);

// Start Server
server.listen(PORT, async () => {
  console.log(`lowpriceplaces API Server running on port ${PORT}`);
  try {
    await syncAllCityListingCounts();
    console.log("Successfully synchronized active listing counts for cities and sub-cities on startup.");
  } catch (err) {
    console.error("Failed to synchronize listing counts on startup:", err);
  }
});
