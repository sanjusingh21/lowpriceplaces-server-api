import { Request, Response } from "express";
import { prisma } from "../config/db";
import { AuthenticatedRequest } from "../middlewares/auth";

export class InquiryController {
  // Send New Inquiry
  static async sendInquiry(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { listingId, message } = req.body;
      if (!listingId || !message) {
        return res
          .status(400)
          .json({ error: "Listing ID and message text are required." });
      }

      const inquiry = await prisma.inquiry.create({
        data: {
          listingId: parseInt(listingId),
          buyerId: req.user.id,
          message,
          messages: {
            create: {
              senderId: req.user.id,
              text: message,
            },
          },
        },
      });

      return res.status(201).json(inquiry);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get Inquiries Sent to a Seller
  static async getSellerInquiries(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const userId = req.user.id;

      const inquiries = await prisma.inquiry.findMany({
        where: {
          listing: { sellerId: userId },
        },
        include: {
          buyer: {
            select: {
              id: true,
              username: true,
              phoneNumber: true,
              whatsappNumber: true,
            },
          },
          listing: {
            select: { id: true, title: true, price: true, sellerId: true },
          },
          messages: {
            include: {
              sender: { select: { id: true, username: true, role: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      const formatted = await Promise.all(
        inquiries.map(async (inq) => {
          let msgs = [...inq.messages];
          if (msgs.length === 0) {
            msgs.push({
              id: `legacy-buyer-${inq.id}` as any,
              inquiryId: inq.id,
              senderId: inq.buyerId,
              sender: {
                id: inq.buyerId,
                username: inq.buyer?.username || "Buyer",
                role: "BUYER",
              },
              text: inq.message,
              createdAt: inq.createdAt,
            } as any);
            if (inq.replyMessage) {
              msgs.push({
                id: `legacy-seller-${inq.id}` as any,
                inquiryId: inq.id,
                senderId: userId,
                sender: {
                  id: userId,
                  username: req.user?.username || "",
                  role: "SELLER",
                },
                text: inq.replyMessage,
                createdAt: inq.createdAt,
              } as any);
            }
          }

          const latestMessage = msgs[msgs.length - 1];

          const unreadCount =
            inq.status === "READ"
              ? 0
              : await prisma.message.count({
                  where: {
                    inquiryId: inq.id,
                    senderId: { not: userId },
                  },
                });

          return {
            ...inq,
            latestMessage,
            unreadCount,
            messages: [latestMessage],
          };
        })
      );

      formatted.sort((a, b) => {
        const timeA = new Date(
          a.latestMessage?.createdAt || a.createdAt
        ).getTime();
        const timeB = new Date(
          b.latestMessage?.createdAt || b.createdAt
        ).getTime();
        return timeB - timeA;
      });

      return res.json(formatted);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get Inquiries Sent by a Buyer
  static async getBuyerInquiries(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const userId = req.user.id;

      const inquiries = await prisma.inquiry.findMany({
        where: { buyerId: userId },
        include: {
          buyer: { select: { id: true, username: true } },
          listing: {
            select: {
              id: true,
              title: true,
              price: true,
              sellerId: true,
              seller: {
                select: {
                  id: true,
                  username: true,
                  phoneNumber: true,
                  whatsappNumber: true,
                },
              },
            },
          },
          messages: {
            include: {
              sender: { select: { id: true, username: true, role: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      const formatted = await Promise.all(
        inquiries.map(async (inq) => {
          let msgs = [...inq.messages];
          if (msgs.length === 0) {
            msgs.push({
              id: `legacy-buyer-${inq.id}` as any,
              inquiryId: inq.id,
              senderId: inq.buyerId,
              sender: {
                id: inq.buyerId,
                username: req.user?.username || "",
                role: "BUYER",
              },
              text: inq.message,
              createdAt: inq.createdAt,
            } as any);
            if (inq.replyMessage) {
              msgs.push({
                id: `legacy-seller-${inq.id}` as any,
                inquiryId: inq.id,
                senderId: inq.listing.sellerId,
                sender: {
                  id: inq.listing.sellerId,
                  username: inq.listing.seller?.username || "Seller",
                  role: "SELLER",
                },
                text: inq.replyMessage,
                createdAt: inq.createdAt,
              } as any);
            }
          }

          const latestMessage = msgs[msgs.length - 1];

          const unreadCount =
            inq.status === "READ"
              ? 0
              : await prisma.message.count({
                  where: {
                    inquiryId: inq.id,
                    senderId: { not: userId },
                  },
                });

          return {
            ...inq,
            latestMessage,
            unreadCount,
            messages: [latestMessage],
          };
        })
      );

      formatted.sort((a, b) => {
        const timeA = new Date(
          a.latestMessage?.createdAt || a.createdAt
        ).getTime();
        const timeB = new Date(
          b.latestMessage?.createdAt || b.createdAt
        ).getTime();
        return timeB - timeA;
      });

      return res.json(formatted);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Reply / Send Message in Inquiry
  static async sendMessage(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const inquiryId = parseInt(req.params.id as string, 10);
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "Message text is required." });
      }

      const inquiry = await prisma.inquiry.findUnique({
        where: { id: inquiryId },
        include: { listing: true },
      });

      if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });

      const isBuyer = inquiry.buyerId === req.user.id;
      const isSeller = inquiry.listing.sellerId === req.user.id;
      const isAdmin = req.user.role === "ADMIN";

      if (!isBuyer && !isSeller && !isAdmin) {
        return res.status(403).json({
          error: "Forbidden: You are not a participant in this conversation.",
        });
      }

      const newMessage = await prisma.message.create({
        data: {
          inquiryId,
          senderId: req.user.id,
          text: text.trim(),
        },
        include: {
          sender: { select: { id: true, username: true, role: true } },
        },
      });

      await prisma.inquiry.update({
        where: { id: inquiryId },
        data: {
          status: isSeller ? "REPLIED" : "UNREAD",
          ...(isSeller ? { replyMessage: text.trim() } : {}),
        },
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`inquiry_${inquiryId}`).emit("receive_message", newMessage);
      }

      return res.status(201).json(newMessage);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Start or Get existing Direct Chat Session
  static async startChat(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { listingId, initialMessage } = req.body;
      if (!listingId)
        return res.status(400).json({ error: "Listing ID is required." });

      const listing = await prisma.listing.findUnique({
        where: { id: parseInt(listingId) },
        include: { seller: true },
      });

      if (!listing) return res.status(404).json({ error: "Listing not found." });
      if (listing.sellerId === req.user.id) {
        return res.status(400).json({
          error: "You cannot start a chat with yourself on your own listing.",
        });
      }

      let inquiry = await prisma.inquiry.findFirst({
        where: {
          listingId: listing.id,
          buyerId: req.user.id,
        },
        include: {
          buyer: { select: { id: true, username: true } },
          listing: {
            select: {
              id: true,
              title: true,
              price: true,
              imagePath: true,
              sellerId: true,
              seller: { select: { id: true, username: true, profile: true } },
            },
          },
          messages: {
            include: {
              sender: { select: { id: true, username: true, role: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!inquiry) {
        const firstMsgText =
          initialMessage && initialMessage.trim()
            ? initialMessage.trim()
            : `Hi! Is "${listing.title}" available?`;
        inquiry = await prisma.inquiry.create({
          data: {
            listingId: listing.id,
            buyerId: req.user.id,
            message: firstMsgText,
            messages: {
              create: {
                senderId: req.user.id,
                text: firstMsgText,
              },
            },
          },
          include: {
            buyer: { select: { id: true, username: true } },
            listing: {
              select: {
                id: true,
                title: true,
                price: true,
                imagePath: true,
                sellerId: true,
                seller: { select: { id: true, username: true, profile: true } },
              },
            },
            messages: {
              include: {
                sender: { select: { id: true, username: true, role: true } },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        });
      }

      return res.json(inquiry);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get All Active Chats for the Logged In User
  static async getAllChats(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const userId = req.user.id;

      const inquiries = await prisma.inquiry.findMany({
        where: {
          OR: [{ buyerId: userId }, { listing: { sellerId: userId } }],
        },
        include: {
          buyer: {
            select: {
              id: true,
              username: true,
              phoneNumber: true,
              whatsappNumber: true,
            },
          },
          listing: {
            select: {
              id: true,
              title: true,
              price: true,
              imagePath: true,
              sellerId: true,
              seller: {
                select: {
                  id: true,
                  username: true,
                  phoneNumber: true,
                  whatsappNumber: true,
                  profile: true,
                },
              },
            },
          },
          messages: {
            include: {
              sender: { select: { id: true, username: true, role: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      const formatted = await Promise.all(
        inquiries.map(async (inq) => {
          let msgs = [...inq.messages];
          if (msgs.length === 0) {
            msgs.push({
              id: `legacy-buyer-${inq.id}` as any,
              inquiryId: inq.id,
              senderId: inq.buyerId,
              sender: {
                id: inq.buyerId,
                username: inq.buyer?.username || "Buyer",
                role: "BUYER",
              },
              text: inq.message,
              createdAt: inq.createdAt,
            } as any);
            if (inq.replyMessage) {
              msgs.push({
                id: `legacy-seller-${inq.id}` as any,
                inquiryId: inq.id,
                senderId: inq.listing?.sellerId,
                sender: {
                  id: inq.listing?.sellerId,
                  username: inq.listing?.seller?.username || "Seller",
                  role: "SELLER",
                },
                text: inq.replyMessage,
                createdAt: inq.createdAt,
              } as any);
            }
          }

          const latestMessage = msgs[msgs.length - 1];

          const unreadCount =
            inq.status === "READ"
              ? 0
              : await prisma.message.count({
                  where: {
                    inquiryId: inq.id,
                    senderId: { not: userId },
                  },
                });

          const otherUserRaw =
            inq.buyerId === userId
              ? {
                  id: inq.listing?.sellerId,
                  name:
                    inq.listing?.seller?.profile?.displayName ||
                    inq.listing?.seller?.username?.split("@")[0] ||
                    "Seller",
                  phoneNumber:
                    inq.listing?.seller?.phoneNumber ||
                    inq.listing?.seller?.whatsappNumber ||
                    "",
                  role: "SELLER",
                }
              : {
                  id: inq.buyerId,
                  name: inq.buyer?.username?.split("@")[0] || "Buyer",
                  phoneNumber:
                    inq.buyer?.phoneNumber || inq.buyer?.whatsappNumber || "",
                  role: "BUYER",
                };

          const otherUser = {
            ...otherUserRaw,
            isOnline: (otherUserRaw.id || 0) % 3 !== 0,
          };

          return {
            ...inq,
            otherUser,
            latestMessage,
            unreadCount,
            messages: [latestMessage],
          };
        })
      );

      formatted.sort((a, b) => {
        const timeA = new Date(
          a.latestMessage?.createdAt || a.createdAt
        ).getTime();
        const timeB = new Date(
          b.latestMessage?.createdAt || b.createdAt
        ).getTime();
        return timeB - timeA;
      });

      return res.json(formatted);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Get Messages for a specific Inquiry/Conversation
  static async getInquiryMessages(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const inquiryId = parseInt(req.params.id as string, 10);
      const userId = req.user.id;

      const inquiry = await prisma.inquiry.findUnique({
        where: { id: inquiryId },
        include: { listing: true },
      });

      if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });

      if (
        inquiry.buyerId !== userId &&
        inquiry.listing.sellerId !== userId &&
        req.user.role !== "ADMIN"
      ) {
        return res.status(403).json({
          error: "Forbidden: You are not a participant in this conversation.",
        });
      }

      const messages = await prisma.message.findMany({
        where: { inquiryId },
        include: {
          sender: { select: { id: true, username: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      let msgs = [...messages];
      if (msgs.length === 0) {
        msgs.push({
          id: `legacy-buyer-${inquiry.id}` as any,
          inquiryId: inquiry.id,
          senderId: inquiry.buyerId,
          sender: { id: inquiry.buyerId, username: "Buyer", role: "BUYER" },
          text: inquiry.message,
          createdAt: inquiry.createdAt,
        } as any);
        if (inquiry.replyMessage) {
          msgs.push({
            id: `legacy-seller-${inquiry.id}` as any,
            inquiryId: inquiry.id,
            senderId: inquiry.listing.sellerId,
            sender: {
              id: inquiry.listing.sellerId,
              username: "Seller",
              role: "SELLER",
            },
            text: inquiry.replyMessage,
            createdAt: inquiry.createdAt,
          } as any);
        }
      }

      return res.json(msgs);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Mark Inquiry/Conversation as Read
  static async markAsRead(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const inquiryId = parseInt(req.params.id as string, 10);
      const inquiry = await prisma.inquiry.findUnique({
        where: { id: inquiryId },
        include: { listing: true },
      });

      if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });

      if (
        inquiry.buyerId !== req.user.id &&
        inquiry.listing.sellerId !== req.user.id &&
        req.user.role !== "ADMIN"
      ) {
        return res.status(403).json({
          error: "Forbidden: You are not a participant in this conversation.",
        });
      }

      const updated = await prisma.inquiry.update({
        where: { id: inquiryId },
        data: { status: "READ" },
      });

      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}
