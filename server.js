const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { sendResetEmail } = require('./mailer');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_lowpriceplaces_token_key_777_888";

// Ensure upload directories exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// Middleware
app.use(cors());
app.use(express.json());

// Multer storage setup for product images & review media (photos/videos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|mp4|mov|avi|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type: Only JPEG, JPG, PNG, WEBP images and MP4, MOV, AVI, MKV videos are allowed.'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limits for videos
});

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Access Denied: No Token Provided" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Access Denied: Invalid Token" });
    req.user = decoded;
    next();
  });
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: Restricted to ${allowedRoles.join(', ')} roles.` });
    }
    next();
  };
}

// --- API ROUTES ---

// 1. AUTHENTICATION

// User Registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: "Email, password and role are required." });
    }

    const validRoles = ["ADMIN", "EDITOR", "SEO", "SELLER", "BUYER"];
    const userRole = role.toUpperCase();
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    const existingUser = await prisma.user.findUnique({ where: { username: email } });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered." });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const user = await prisma.user.create({
      data: {
        username: email,
        password: hashedPassword,
        role: userRole
      }
    });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Current User Profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, username: true, role: true, phoneNumber: true, whatsappNumber: true }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Google Auth Sign-In / Sign-Up
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential, role } = req.body;
    if (!credential) {
      return res.status(400).json({ error: "Credential token is required." });
    }

    // Verify token with Google's OAuth2 API
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (!response.ok) {
      return res.status(400).json({ error: "Invalid Google token." });
    }
    const payload = await response.json();
    const email = payload.email;
    if (!email) {
      return res.status(400).json({ error: "Email not retrieved from Google." });
    }

    // Check if user exists
    let user = await prisma.user.findUnique({ where: { username: email } });
    if (!user) {
      // Prevent automatic registration without a valid role selection
      const userRole = role ? role.toUpperCase() : '';
      if (userRole !== 'BUYER' && userRole !== 'SELLER') {
        return res.status(400).json({ error: "Account not found. Please register first to choose your account type." });
      }

      // Create new user with Google signup
      // Generate random password for google account
      const randomPassword = bcrypt.hashSync(Math.random().toString(36), 10);
      user = await prisma.user.create({
        data: {
          username: email,
          password: randomPassword,
          role: userRole
        }
      });
    }

    // Generate JWT token
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Forgot Password - Send Reset Link
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const user = await prisma.user.findUnique({ where: { username: email } });
    if (!user) {
      // Security best practice: don't reveal if user exists, but let's confirm success
      return res.json({ message: "If the email exists, a reset link has been generated." });
    }

    // Generate temporary reset token (expires in 15 minutes)
    const resetToken = jwt.sign({ id: user.id, email: user.username }, JWT_SECRET, { expiresIn: '15m' });

    const resetLink = `${process.env.CLIENT_URL}/#/reset-password?token=${resetToken}`;

    // Send actual email using SMTP transporter
    await sendResetEmail(email, resetLink);

    res.json({
      message: "If the email exists, a password reset link has been sent to your inbox."
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset Password - Verify Token & Save New Password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required." });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }

    const userId = decoded.id;
    const hashedPassword = bcrypt.hashSync(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.json({ message: "Password reset successfully. You can now login with your new password." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 2. CATEGORIES

// Get Categories & Subcategories
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: { subCategories: true }
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Category (Admin/Editor Only)
app.post('/api/categories', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: "Category name is required." });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const category = await prisma.category.create({
      data: { name, slug, emoji: emoji || "📁" }
    });
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Category (Admin/Editor Only)
app.put('/api/categories/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: "Category name is required." });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const updated = await prisma.category.update({
      where: { id },
      data: { name, slug, emoji }
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Category (Admin/Editor Only)
app.delete('/api/categories/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.category.delete({ where: { id } });
    res.json({ message: "Category deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Subcategory (Admin/Editor Only)
app.post('/api/categories/:categoryId/subcategories', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const { name, emoji } = req.body;
    const categoryId = parseInt(req.params.categoryId);
    if (!name) return res.status(400).json({ error: "Subcategory name is required." });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const subCategory = await prisma.subCategory.create({
      data: { name, slug, emoji: emoji || "🔹", categoryId }
    });
    res.status(201).json(subCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Subcategory (Admin/Editor Only)
app.put('/api/subcategories/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: "Subcategory name is required." });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const updated = await prisma.subCategory.update({
      where: { id },
      data: { name, slug, emoji }
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Subcategory (Admin/Editor Only)
app.delete('/api/subcategories/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.subCategory.delete({ where: { id } });
    res.json({ message: "Subcategory deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 3. LISTINGS & GLOBAL SEARCH

// Get/Search Listings
app.get('/api/listings', async (req, res) => {
  try {
    const { q, categoryId, subCategoryId, minPrice, maxPrice, location, status, discountOnly, sellerId, dateFilter, sortBy } = req.query;

    const filters = {};

    if (sellerId) {
      filters.sellerId = parseInt(sellerId);
    }

    // Filter by status (public listings show active, Admin/Editor see all)
    if (status && status !== 'ALL') {
      filters.status = status;
    } else if (!status) {
      filters.status = "ACTIVE";
    }

    if (categoryId) {
      filters.categoryId = parseInt(categoryId);
    }
    if (subCategoryId) {
      filters.subCategoryId = parseInt(subCategoryId);
    }

    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.gte = parseFloat(minPrice);
      if (maxPrice) filters.price.lte = parseFloat(maxPrice);
    }

    if (location) {
      filters.location = { contains: location, mode: 'insensitive' };
    }

    if (discountOnly === 'true') {
      filters.discountPercent = { gt: 0 };
    }

    // Filter by date (today, yesterday, or specific date YYYY-MM-DD)
    if (dateFilter) {
      let start, end;
      if (dateFilter === 'today') {
        start = new Date();
        start.setHours(0, 0, 0, 0);
        end = new Date();
        end.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'yesterday') {
        start = new Date();
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        end = new Date();
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
      } else {
        const parsed = Date.parse(dateFilter);
        if (!isNaN(parsed)) {
          start = new Date(parsed);
          start.setHours(0, 0, 0, 0);
          end = new Date(parsed);
          end.setHours(23, 59, 59, 999);
        }
      }
      if (start && end) {
        filters.createdAt = {
          gte: start,
          lte: end
        };
      }
    }

    // Global Search (Amazon style)
    if (q) {
      filters.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
        { subCategory: { name: { contains: q, mode: 'insensitive' } } },
        { location: { contains: q, mode: 'insensitive' } }
      ];

      // Parse for numeric ID search (supporting direct integer or LPP-XXXXX format)
      const cleanIdStr = q.replace(/^LPP-/i, '').trim();
      if (/^\d+$/.test(cleanIdStr)) {
        const numericId = parseInt(cleanIdStr, 10);
        filters.OR.push({ id: numericId });
      }
    }

    // Sort order mapping
    let orderOption = { createdAt: 'desc' }; // default: newest first
    if (sortBy === 'price_asc') {
      orderOption = { price: 'asc' };
    } else if (sortBy === 'price_desc') {
      orderOption = { price: 'desc' };
    } else if (sortBy === 'date_asc') {
      orderOption = { createdAt: 'asc' };
    } else if (sortBy === 'date_desc') {
      orderOption = { createdAt: 'desc' };
    }

    const listings = await prisma.listing.findMany({
      where: filters,
      include: {
        category: true,
        subCategory: true,
        seller: {
          select: { username: true, role: true }
        },
        reviews: {
          select: { rating: true }
        },
        moderatedBy: {
          select: { username: true, role: true }
        }
      },
      orderBy: orderOption
    });

    // Calculate dynamic average rating on list load
    const enrichedListings = listings.map(l => {
      const avg = l.reviews.length > 0
        ? l.reviews.reduce((acc, curr) => acc + curr.rating, 0) / l.reviews.length
        : 0;
      return {
        ...l,
        averageRating: Number(avg.toFixed(1)),
        totalReviews: l.reviews.length
      };
    });

    res.json(enrichedListings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Listing (Seller / Admin / Editor Only)
app.post('/api/listings', authenticateToken, requireRole(['SELLER', 'ADMIN', 'EDITOR']), upload.array('image', 10), async (req, res) => {
  try {
    const { title, description, price, discountPercent, location, whatsappNumber, contactNumber, categoryId, subCategoryId } = req.body;

    if (!title || !description || !price || !location || !whatsappNumber || !contactNumber || !categoryId) {
      return res.status(400).json({ error: "Required fields are missing." });
    }

    const imagePath = req.files && req.files.length > 0
      ? req.files.map(file => `/uploads/${file.filename}`).join(',')
      : null;

    const listing = await prisma.listing.create({
      data: {
        title,
        description,
        price: parseFloat(price),
        discountPercent: parseFloat(discountPercent || 0),
        location,
        whatsappNumber,
        contactNumber,
        imagePath,
        sellerId: req.user.id,
        categoryId: parseInt(categoryId),
        subCategoryId: subCategoryId ? parseInt(subCategoryId) : null,
        status: req.user.role === 'SELLER' ? 'PENDING' : 'ACTIVE' // Sellers need approval, admins/editors auto-approve
      }
    });

    res.status(201).json(listing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Listing Details by ID (loads reviews and SEO)
app.get('/api/listings/:id', async (req, res) => {
  try {
    const listingId = parseInt(req.params.id);

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        category: true,
        subCategory: true,
        seller: { select: { id: true, username: true, phoneNumber: true, whatsappNumber: true } },
        reviews: {
          include: { buyer: { select: { username: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!listing) return res.status(404).json({ error: "Listing not found." });

    // Fetch SEO metadata for this specific listing path
    const seo = await prisma.sEOMeta.findUnique({
      where: { routePath: `/listings/${listingId}` }
    });

    const totalRating = listing.reviews.reduce((acc, r) => acc + r.rating, 0);
    const avgRating = listing.reviews.length > 0 ? (totalRating / listing.reviews.length).toFixed(1) : 0;

    res.json({
      ...listing,
      averageRating: Number(avgRating),
      totalReviews: listing.reviews.length,
      seo: seo || {
        titleTag: `${listing.title} - Buy on lowpriceplaces`,
        metaDescription: `${listing.description.substring(0, 150)}... Buy at ${listing.price}$ in ${listing.location}`,
        keywords: `${listing.title.toLowerCase().split(' ').join(', ')}, classifieds`
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Listing Status (Admin/Editor Only - For Approve / Reject / Sold toggles)
app.put('/api/listings/:id/status', authenticateToken, requireRole(['ADMIN', 'EDITOR', 'SELLER']), async (req, res) => {
  try {
    const listingId = parseInt(req.params.id);
    const { status, rejectReason } = req.body;

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    // Sellers can mark their own listing as SOLD. Admins/Editors can mark as ACTIVE, PENDING, or REJECTED.
    if (req.user.role === 'SELLER' && listing.sellerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden: You do not own this listing." });
    }

    if (req.user.role === 'SELLER' && status !== 'SOLD') {
      return res.status(403).json({ error: "Forbidden: Sellers can only update status to SOLD." });
    }

    if (status === 'REJECTED' && (!rejectReason || !rejectReason.trim())) {
      return res.status(400).json({ error: "A rejection reason is required when rejecting a listing." });
    }

    const dataUpdate = { status };
    if (status === 'REJECTED') {
      dataUpdate.rejectReason = rejectReason;
    } else {
      dataUpdate.rejectReason = null;
    }

    if (['ADMIN', 'EDITOR'].includes(req.user.role)) {
      dataUpdate.moderatedById = req.user.id;
      dataUpdate.moderatedAt = new Date();
    }

    const updatedListing = await prisma.listing.update({
      where: { id: listingId },
      data: dataUpdate
    });

    res.json(updatedListing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Listing Details (Admin/Editor or Seller Owner)
app.put('/api/listings/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR', 'SELLER']), upload.array('image', 10), async (req, res) => {
  try {
    const listingId = parseInt(req.params.id);
    const { title, description, price, discountPercent, location, whatsappNumber, contactNumber, categoryId, subCategoryId } = req.body;

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    // Validate ownership if seller
    if (req.user.role === 'SELLER' && listing.sellerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden: You do not own this listing." });
    }

    const imagePaths = req.files && req.files.length > 0
      ? req.files.map(file => `/uploads/${file.filename}`).join(',')
      : undefined;

    const updatedData = {};
    if (imagePaths !== undefined) updatedData.imagePath = imagePaths;
    if (title !== undefined) updatedData.title = title;
    if (description !== undefined) updatedData.description = description;
    if (price !== undefined) updatedData.price = parseFloat(price);
    if (discountPercent !== undefined) updatedData.discountPercent = parseFloat(discountPercent);
    if (location !== undefined) updatedData.location = location;
    if (whatsappNumber !== undefined) updatedData.whatsappNumber = whatsappNumber;
    if (contactNumber !== undefined) updatedData.contactNumber = contactNumber;
    if (categoryId !== undefined) updatedData.categoryId = parseInt(categoryId);
    if (subCategoryId !== undefined) updatedData.subCategoryId = subCategoryId ? parseInt(subCategoryId) : null;

    // Reset status to PENDING and clear reject reason if edited by the seller
    if (req.user.role === 'SELLER') {
      updatedData.status = 'PENDING';
      updatedData.rejectReason = null;
    }

    const updatedListing = await prisma.listing.update({
      where: { id: listingId },
      data: updatedData
    });

    res.json(updatedListing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Delete Listing (Admin, Editor, or Listing Owner)
app.delete('/api/listings/:id', authenticateToken, async (req, res) => {
  try {
    const listingId = parseInt(req.params.id);
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    if (req.user.role !== 'ADMIN' && req.user.role !== 'EDITOR' && listing.sellerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden: Access denied." });
    }

    await prisma.listing.delete({ where: { id: listingId } });
    res.json({ message: "Listing deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 4. REVIEWS & RATINGS

// Submit Review with Multi-Media (Buyer / Admin / Editor Only)
app.post('/api/listings/:id/reviews', authenticateToken, requireRole(['BUYER', 'ADMIN', 'EDITOR']), upload.fields([{ name: 'images', maxCount: 5 }, { name: 'videos', maxCount: 2 }]), async (req, res) => {
  try {
    const listingId = parseInt(req.params.id);
    const { rating, comment } = req.body;

    if (!rating || !comment) {
      return res.status(400).json({ error: "Rating (1-5) and comment are required." });
    }

    const images = req.files && req.files['images'] ? req.files['images'].map(f => `/uploads/${f.filename}`) : [];
    const videos = req.files && req.files['videos'] ? req.files['videos'].map(f => `/uploads/${f.filename}`) : [];

    const review = await prisma.review.create({
      data: {
        listingId,
        buyerId: req.user.id,
        rating: parseInt(rating),
        comment,
        images,
        videos
      },
      include: {
        buyer: { select: { username: true } }
      }
    });

    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Review (Admin, Editor, or Author Only)
app.delete('/api/reviews/:id', authenticateToken, async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return res.status(404).json({ error: "Review not found" });

    if (req.user.role !== 'ADMIN' && req.user.role !== 'EDITOR' && review.buyerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden: Action not allowed." });
    }

    await prisma.review.delete({ where: { id: reviewId } });
    res.json({ message: "Review deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 5. IN-APP INQUIRIES & CHAT

// Send New Inquiry (Buyer Only)
// Send New Inquiry (Buyer Only)
app.post('/api/inquiries', authenticateToken, requireRole(['BUYER', 'ADMIN']), async (req, res) => {
  try {
    const { listingId, message } = req.body;
    if (!listingId || !message) {
      return res.status(400).json({ error: "Listing ID and message text are required." });
    }

    const inquiry = await prisma.inquiry.create({
      data: {
        listingId: parseInt(listingId),
        buyerId: req.user.id,
        message,
        messages: {
          create: {
            senderId: req.user.id,
            text: message
          }
        }
      }
    });

    res.status(201).json(inquiry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Inquiries Sent to a Seller (Seller dashboard leads)
app.get('/api/inquiries/seller', authenticateToken, requireRole(['SELLER', 'ADMIN']), async (req, res) => {
  try {
    const inquiries = await prisma.inquiry.findMany({
      where: {
        listing: { sellerId: req.user.id }
      },
      include: {
        buyer: { select: { username: true, phoneNumber: true, whatsappNumber: true } },
        listing: { select: { id: true, title: true, price: true, sellerId: true } },
        messages: {
          include: {
            sender: { select: { username: true, role: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = inquiries.map(inq => {
      let msgs = [...inq.messages];
      if (msgs.length === 0) {
        msgs.push({
          id: `legacy-buyer-${inq.id}`,
          inquiryId: inq.id,
          senderId: inq.buyerId,
          sender: { username: inq.buyer?.username || 'Buyer', role: 'BUYER' },
          text: inq.message,
          createdAt: inq.createdAt
        });
        if (inq.replyMessage) {
          msgs.push({
            id: `legacy-seller-${inq.id}`,
            inquiryId: inq.id,
            senderId: req.user.id,
            sender: { username: req.user.username, role: 'SELLER' },
            text: inq.replyMessage,
            createdAt: inq.createdAt
          });
        }
      }
      return { ...inq, messages: msgs };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Inquiries Sent by a Buyer (Buyer dashboard history)
app.get('/api/inquiries/buyer', authenticateToken, requireRole(['BUYER', 'ADMIN']), async (req, res) => {
  try {
    const inquiries = await prisma.inquiry.findMany({
      where: { buyerId: req.user.id },
      include: {
        buyer: { select: { username: true } },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            sellerId: true,
            seller: { select: { username: true, phoneNumber: true, whatsappNumber: true } }
          }
        },
        messages: {
          include: {
            sender: { select: { username: true, role: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = inquiries.map(inq => {
      let msgs = [...inq.messages];
      if (msgs.length === 0) {
        msgs.push({
          id: `legacy-buyer-${inq.id}`,
          inquiryId: inq.id,
          senderId: inq.buyerId,
          sender: { username: req.user.username, role: 'BUYER' },
          text: inq.message,
          createdAt: inq.createdAt
        });
        if (inq.replyMessage) {
          msgs.push({
            id: `legacy-seller-${inq.id}`,
            inquiryId: inq.id,
            senderId: inq.listing.sellerId,
            sender: { username: inq.listing.seller?.username || 'Seller', role: 'SELLER' },
            text: inq.replyMessage,
            createdAt: inq.createdAt
          });
        }
      }
      return { ...inq, messages: msgs };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reply to Inquiry (Seller Only - Legacy endpoint)
app.post('/api/inquiries/:id/reply', authenticateToken, requireRole(['SELLER', 'ADMIN']), async (req, res) => {
  try {
    const inquiryId = parseInt(req.params.id);
    const { replyMessage } = req.body;
    if (!replyMessage) return res.status(400).json({ error: "Reply message is required." });

    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: { listing: true }
    });

    if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });
    if (inquiry.listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Forbidden: You are not the seller of this product." });
    }

    // Insert into Message table
    await prisma.message.create({
      data: {
        inquiryId,
        senderId: req.user.id,
        text: replyMessage
      }
    });

    const updatedInquiry = await prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        replyMessage,
        status: "REPLIED"
      }
    });

    res.json(updatedInquiry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message in existing Inquiry/Conversation (Buyer or Seller)
app.post('/api/inquiries/:id/messages', authenticateToken, async (req, res) => {
  try {
    const inquiryId = parseInt(req.params.id);
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Message text is required." });

    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: { listing: true }
    });

    if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });

    const isBuyer = inquiry.buyerId === req.user.id;
    const isSeller = inquiry.listing.sellerId === req.user.id;

    if (!isBuyer && !isSeller && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Forbidden: You are not a participant in this conversation." });
    }

    // Create the message
    const newMessage = await prisma.message.create({
      data: {
        inquiryId,
        senderId: req.user.id,
        text
      },
      include: {
        sender: { select: { username: true, role: true } }
      }
    });

    // Update status and legacy replyMessage field if sent by seller
    await prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        status: isSeller ? "REPLIED" : "UNREAD",
        ...(isSeller ? { replyMessage: text } : {})
      }
    });

    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark Inquiry/Conversation as Read
app.post('/api/inquiries/:id/read', authenticateToken, async (req, res) => {
  try {
    const inquiryId = parseInt(req.params.id);
    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: { listing: true }
    });

    if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });

    if (inquiry.buyerId !== req.user.id && inquiry.listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Forbidden: You are not a participant in this conversation." });
    }

    const updated = await prisma.inquiry.update({
      where: { id: inquiryId },
      data: { status: "READ" }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 6. SEO METADATA CONTROLS (SEO Team & Admin)

// Get SEO Metadata for a Page Route
app.get('/api/seo', async (req, res) => {
  try {
    const { path: routePath } = req.query;
    if (!routePath) return res.status(400).json({ error: "Query path is required." });

    const seo = await prisma.sEOMeta.findUnique({
      where: { routePath }
    });

    if (!seo) return res.json({ titleTag: "", metaDescription: "", keywords: "" });
    res.json(seo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save/Update SEO Metadata (SEO Team & Admin Only)
app.post('/api/seo', authenticateToken, requireRole(['SEO', 'ADMIN']), async (req, res) => {
  try {
    const { routePath, titleTag, metaDescription, keywords } = req.body;
    if (!routePath || !titleTag || !metaDescription) {
      return res.status(400).json({ error: "routePath, titleTag and metaDescription are required." });
    }

    const seo = await prisma.sEOMeta.upsert({
      where: { routePath },
      update: { titleTag, metaDescription, keywords },
      create: { routePath, titleTag, metaDescription, keywords }
    });

    res.json(seo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 7. USER MANAGEMENT (Admin Only)

// Fetch All Users
app.get('/api/users', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, phoneNumber: true, whatsappNumber: true }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update User Role
app.put('/api/users/:id/role', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role } = req.body;

    const validRoles = ["ADMIN", "EDITOR", "SEO", "SELLER", "BUYER"];
    const userRole = role.toUpperCase();
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role: userRole }
    });

    res.json({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create User (Admin Only)
app.post('/api/users', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { username, role, phoneNumber, whatsappNumber } = req.body;
    if (!username || !role) {
      return res.status(400).json({ error: "Username and role are required." });
    }
    const validRoles = ["ADMIN", "EDITOR", "SEO", "SELLER", "BUYER"];
    const userRole = role.toUpperCase();
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ error: "Invalid role." });
    }
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists." });
    }
    const hashedPassword = bcrypt.hashSync("password123", 10); // default password
    const user = await prisma.user.create({
      data: {
        username,
        role: userRole,
        password: hashedPassword,
        phoneNumber: phoneNumber || null,
        whatsappNumber: whatsappNumber || null
      }
    });
    res.status(201).json({ id: user.id, username: user.username, role: user.role, phoneNumber: user.phoneNumber, whatsappNumber: user.whatsappNumber });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update User (Admin Only)
app.put('/api/users/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { username, role, phoneNumber, whatsappNumber } = req.body;
    if (!username || !role) {
      return res.status(400).json({ error: "Username and role are required." });
    }
    const validRoles = ["ADMIN", "EDITOR", "SEO", "SELLER", "BUYER"];
    const userRole = role.toUpperCase();
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ error: "Invalid role." });
    }
    const existingUser = await prisma.user.findFirst({
      where: {
        username,
        id: { not: userId }
      }
    });
    if (existingUser) {
      return res.status(400).json({ error: "Username already registered by another user." });
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        username,
        role: userRole,
        phoneNumber: phoneNumber || null,
        whatsappNumber: whatsappNumber || null
      }
    });
    res.json({ id: updated.id, username: updated.username, role: updated.role, phoneNumber: updated.phoneNumber, whatsappNumber: updated.whatsappNumber });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete User (Admin Only)
app.delete('/api/users/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (req.user.id === userId) {
      return res.status(400).json({ error: "Cannot delete your own administrative account." });
    }
    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: "User deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- CITIES MANAGEMENT ENDPOINTS (ADMIN ONLY CRUD) ---

// 1. Get All Cities (Public)
app.get('/api/cities', async (req, res) => {
  try {
    const cities = await prisma.city.findMany({ orderBy: { name: 'asc' } });
    res.json(cities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Add a New City (Admin Only)
app.post('/api/cities', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: "City name is required." });
    
    // Check if city already exists
    const existing = await prisma.city.findUnique({ where: { name } });
    if (existing) return res.status(400).json({ error: "City already exists." });

    const city = await prisma.city.create({
      data: {
        name,
        emoji: emoji || "📍"
      }
    });
    res.status(201).json(city);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Delete a City (Admin Only)
app.delete('/api/cities/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.city.delete({ where: { id: parseInt(id, 10) } });
    res.json({ message: "City deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Update a City (Admin Only)
app.put('/api/cities/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: "City name is required." });
    
    const updated = await prisma.city.update({
      where: { id: parseInt(id, 10) },
      data: { name, emoji }
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`lowpriceplaces API Server running on port ${PORT}`);
});
