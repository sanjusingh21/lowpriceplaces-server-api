const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  socket.on('join_room', (inquiryId) => {
    if (inquiryId) {
      socket.join(`inquiry_${inquiryId}`);
    }
  });

  socket.on('send_message', (data) => {
    if (data && data.inquiryId) {
      io.to(`inquiry_${data.inquiryId}`).emit('receive_message', data);
    }
  });
});

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

const mediaRoutes = require('./dist/routes/media.routes').default;
app.use('/api/media', mediaRoutes);

const { S3Service } = require('./dist/services/s3.service');
const { bucketName } = require('./dist/config/aws');

async function promoteListingImages(imagePath) {
  if (!imagePath) return;
  try {
    const urls = imagePath.split(',');
    for (const url of urls) {
      let key = null;
      const viewPrefix = "/api/media/view/";
      const viewIdx = url.indexOf(viewPrefix);
      if (viewIdx !== -1) {
        key = url.substring(viewIdx + viewPrefix.length);
      } else {
        const s3UrlPattern = new RegExp(`https://${bucketName}\\.s3\\.amazonaws\\.com/(.+)`);
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
            status: "COMMITTED"
          }
        });

        // 2. Call S3 to update Tag to Status=Committed
        await S3Service.promoteObject(key);
      }
    }
  } catch (err) {
    console.error("Failed to promote listing S3 objects:", err);
  }
}

// Hourly cleanup of uncommitted database metadata records older than 24 hours
setInterval(async () => {
  try {
    const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    const deletedCount = await prisma.media.deleteMany({
      where: {
        status: "UNCOMMITTED",
        createdAt: { lt: threshold }
      }
    });
    if (deletedCount.count > 0) {
      console.log(`[Lifecycle Cleanup] Cleaned up ${deletedCount.count} expired uncommitted media records from database.`);
    }
  } catch (err) {
    console.error("[Lifecycle Cleanup] Error running database media cleanup:", err);
  }
}, 4 * 60 * 60 * 1000); // Run every 4 hours

const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('./dist/config/aws');

async function uploadLocalToS3(filePath, key, mimeType) {
  const fileBuffer = fs.readFileSync(filePath);
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
    Tagging: "Status=Committed"
  });
  await s3Client.send(command);
  fs.unlinkSync(filePath);
}

async function autoUploadMulterToS3(req, res, next) {
  try {
    const protocol = req.protocol;
    const host = req.get('host');

    if (req.file) {
      const localPath = req.file.path;
      const key = `admin/${Date.now()}-${req.file.filename}`;
      await uploadLocalToS3(localPath, key, req.file.mimetype);
      
      req.file.filename = key;
      req.file.path = `${protocol}://${host}/api/media/view/${key}`;
    }

    if (req.files) {
      const filesArray = Array.isArray(req.files) 
        ? req.files 
        : Object.values(req.files).flat();

      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        const localPath = file.path;
        const key = `admin/${Date.now()}-${file.filename}`;
        await uploadLocalToS3(localPath, key, file.mimetype);
        
        file.filename = key;
        file.path = `${protocol}://${host}/api/media/view/${key}`;
      }
    }
  } catch (err) {
    console.error("Auto upload multer to S3 failed:", err);
  }
  next();
}

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

// Multer setup for general image uploads (JPG, JPEG, PNG, WEBP; max 5MB)
const imageUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type: Only JPG, JPEG, PNG, and WEBP images are allowed.'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const { optimizeImage } = require('./utils/imageOptimizer');

const optimizeImagesMiddleware = async (req, res, next) => {
  try {
    if (req.file) {
      const result = await optimizeImage(req.file.path);
      req.file.path = result.optimized;
      req.file.filename = path.basename(result.optimized);
    }
    if (req.files) {
      if (Array.isArray(req.files)) {
        for (let file of req.files) {
          const result = await optimizeImage(file.path);
          file.path = result.optimized;
          file.filename = path.basename(result.optimized);
        }
      } else {
        for (let key in req.files) {
          for (let file of req.files[key]) {
            const result = await optimizeImage(file.path);
            file.path = result.optimized;
            file.filename = path.basename(result.optimized);
          }
        }
      }
    }
    next();
  } catch (error) {
    console.error('Image optimization middleware error:', error);
    next();
  }
};

// Distance Calculation Helper (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1)); // return km distance (1 decimal place)
}

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
    if (!req.user) {
      return res.status(401).json({ error: "Access Denied: No Token Provided" });
    }
    
    const userRoles = [req.user.role];
    if (req.user.role === 'USER') {
      userRoles.push('SELLER', 'BUYER');
    }

    const hasRole = allowedRoles.some(role => userRoles.includes(role));
    if (!hasRole) {
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

    let user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Auto-register on the fly
      const hashedPassword = bcrypt.hashSync(password, 10);
      user = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          role: "USER"
        }
      });
      // Automatically create a default seller profile for the user
      await prisma.profile.create({
        data: {
          userId: user.id,
          fullName: username.split('@')[0],
          displayName: username.split('@')[0],
          professionalTitle: "Independent Member",
          yearsOfExperience: 0,
          businessCategory: "General",
          email: username,
          aboutSeller: "New user on lowpriceplaces.",
          showWhatsapp: true,
          showPhone: true,
          allowChat: true
        }
      });
    } else if (!bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    // Update last login
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        phoneNumber: user.phoneNumber,
        whatsappNumber: user.whatsappNumber,
        fullName: user.fullName,
        profilePicture: user.profilePicture,
        provider: user.provider
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
      select: { id: true, username: true, role: true, phoneNumber: true, whatsappNumber: true, fullName: true, profilePicture: true }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Seller Profile of current user
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: req.user.id }
    });
    res.json(profile || {
      fullName: "",
      displayName: "",
      professionalTitle: "",
      yearsOfExperience: 0,
      businessCategory: "",
      businessType: "",
      aboutSeller: "",
      email: "",
      mobileNumber: "",
      whatsAppNumber: "",
      showWhatsapp: true,
      showPhone: true,
      allowChat: true,
      location: "",
      latitude: null,
      longitude: null,
      imagePath: null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create/Update Seller Profile of current user
app.put('/api/profile', authenticateToken, imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const {
      fullName,
      displayName,
      professionalTitle,
      yearsOfExperience,
      businessCategory,
      businessType,
      aboutSeller,
      email,
      mobileNumber,
      whatsAppNumber,
      showWhatsapp,
      showPhone,
      allowChat,
      location,
      latitude,
      longitude
    } = req.body;

    const existingProfile = await prisma.profile.findUnique({
      where: { userId: req.user.id }
    });

    const parsedLat = latitude ? parseFloat(latitude) : null;
    const parsedLng = longitude ? parseFloat(longitude) : null;

    const imagePath = req.body.imagePath !== undefined 
      ? req.body.imagePath 
      : (req.file ? req.file.path : (existingProfile ? existingProfile.imagePath : null));

    const profile = await prisma.profile.upsert({
      where: { userId: req.user.id },
      update: {
        fullName: fullName || "",
        displayName: displayName || "",
        professionalTitle: professionalTitle || "",
        yearsOfExperience: parseInt(yearsOfExperience) || 0,
        businessCategory: businessCategory || "",
        businessType: businessType || null,
        aboutSeller: aboutSeller || "",
        email: email || "",
        mobileNumber: mobileNumber || null,
        whatsAppNumber: whatsAppNumber || null,
        showWhatsapp: showWhatsapp !== 'false' && showWhatsapp !== false,
        showPhone: showPhone !== 'false' && showPhone !== false,
        allowChat: allowChat !== 'false' && allowChat !== false,
        location: location || null,
        latitude: isNaN(parsedLat) ? null : parsedLat,
        longitude: isNaN(parsedLng) ? null : parsedLng,
        imagePath
      },
      create: {
        userId: req.user.id,
        fullName: fullName || "",
        displayName: displayName || "",
        professionalTitle: professionalTitle || "",
        yearsOfExperience: parseInt(yearsOfExperience) || 0,
        businessCategory: businessCategory || "",
        businessType: businessType || null,
        aboutSeller: aboutSeller || "",
        email: email || "",
        mobileNumber: mobileNumber || null,
        whatsAppNumber: whatsAppNumber || null,
        showWhatsapp: showWhatsapp !== 'false' && showWhatsapp !== false,
        showPhone: showPhone !== 'false' && showPhone !== false,
        allowChat: allowChat !== 'false' && allowChat !== false,
        location: location || null,
        latitude: isNaN(parsedLat) ? null : parsedLat,
        longitude: isNaN(parsedLng) ? null : parsedLng,
        imagePath
      }
    });

    if (imagePath) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { profilePicture: imagePath }
      });
      await promoteListingImages(imagePath);
    }

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Google Auth Sign-In / Sign-Up
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
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

    const googleId = payload.sub;
    const fullName = payload.name || "";
    const profilePicture = payload.picture || null;

    // Check if user exists by email (username)
    let user = await prisma.user.findUnique({ where: { username: email } });
    if (!user) {
      // Create new user automatically with default USER role
      const randomPassword = bcrypt.hashSync(Math.random().toString(36), 10);
      user = await prisma.user.create({
        data: {
          username: email,
          password: randomPassword,
          role: "USER",
          fullName,
          googleId,
          profilePicture,
          provider: "GOOGLE",
          emailVerified: true,
          lastLogin: new Date()
        }
      });
      // Automatically create a default seller profile for the user
      await prisma.profile.create({
        data: {
          userId: user.id,
          fullName: email.split('@')[0],
          displayName: email.split('@')[0],
          professionalTitle: "Independent Member",
          yearsOfExperience: 0,
          businessCategory: "General",
          email: email,
          aboutSeller: "New user on lowpriceplaces.",
          showWhatsapp: true,
          showPhone: true,
          allowChat: true
        }
      });
    } else {
      // User exists, update Google profile fields and lastLogin
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLogin: new Date(),
          fullName: user.fullName || fullName,
          googleId: user.googleId || googleId,
          profilePicture: user.profilePicture || profilePicture,
          provider: user.provider === "MANUAL" ? "GOOGLE" : user.provider,
          emailVerified: true
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
        whatsappNumber: user.whatsappNumber,
        fullName: user.fullName,
        profilePicture: user.profilePicture,
        provider: user.provider
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Switch role dynamically
app.put('/api/auth/switch-role', authenticateToken, async (req, res) => {
  try {
    const { role } = req.body;
    if (role !== 'BUYER' && role !== 'SELLER') {
      return res.status(400).json({ error: "Invalid role. Must be BUYER or SELLER." });
    }
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { role }
    });
    
    // Also ensure seller profile exists if switching to SELLER
    if (role === 'SELLER') {
      const existingProfile = await prisma.profile.findUnique({
        where: { userId: req.user.id }
      });
      if (!existingProfile) {
        await prisma.profile.create({
          data: {
            userId: req.user.id,
            fullName: req.user.username.split('@')[0],
            displayName: req.user.username.split('@')[0] + " Shop",
            professionalTitle: "Independent Seller",
            yearsOfExperience: 1,
            businessCategory: "General",
            email: req.user.username,
            aboutSeller: "A new seller on lowpriceplaces.",
            showWhatsapp: true,
            showPhone: true,
            allowChat: true
          }
        });
      }
    }

    const token = jwt.sign({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
        phoneNumber: updatedUser.phoneNumber,
        whatsappNumber: updatedUser.whatsappNumber
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
app.post('/api/categories', authenticateToken, requireRole(['ADMIN', 'EDITOR']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: "Category name is required." });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const imagePath = req.file ? req.file.path : null;

    const category = await prisma.category.create({
      data: { name, slug, emoji: emoji || "📁", imagePath }
    });
    res.status(201).json(category);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "A category with this name already exists." });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update Category (Admin/Editor Only)
app.put('/api/categories/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, emoji, imagePath } = req.body;
    if (!name) return res.status(400).json({ error: "Category name is required." });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const updateData = { name, slug, emoji: emoji || "📁" };
    if (req.file) {
      updateData.imagePath = req.file.path;
    } else if (imagePath === null || imagePath === "null" || imagePath === "") {
      updateData.imagePath = null;
    }

    const updated = await prisma.category.update({
      where: { id },
      data: updateData
    });
    res.json(updated);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "A category with this name already exists." });
    }
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
app.post('/api/categories/:categoryId/subcategories', authenticateToken, requireRole(['ADMIN', 'EDITOR']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const { name, emoji } = req.body;
    const categoryId = parseInt(req.params.categoryId);
    if (!name) return res.status(400).json({ error: "Subcategory name is required." });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const imagePath = req.file ? req.file.path : null;

    const subCategory = await prisma.subCategory.create({
      data: { name, slug, emoji: emoji || "🔹", imagePath, categoryId }
    });
    res.status(201).json(subCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Subcategory (Admin/Editor Only)
app.put('/api/subcategories/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, emoji, imagePath } = req.body;
    if (!name) return res.status(400).json({ error: "Subcategory name is required." });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const updateData = { name, slug, emoji: emoji || "🔹" };
    if (req.file) {
      updateData.imagePath = req.file.path;
    } else if (imagePath === null || imagePath === "null" || imagePath === "") {
      updateData.imagePath = null;
    }

    const updated = await prisma.subCategory.update({
      where: { id },
      data: updateData
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
// Get nearby stores (filtered by category, sorted by distance)
app.get('/api/stores', async (req, res) => {
  try {
    const { lat, lng, category, page, limit } = req.query;
    
    const filter = {};
    if (category) {
      filter.category = category;
    }

    const stores = await prisma.store.findMany({
      where: filter,
      include: {
        reviews: true
      }
    });

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    const mappedStores = stores.map(store => {
      let distance = null;
      if (!isNaN(userLat) && !isNaN(userLng) && store.latitude && store.longitude) {
        distance = calculateDistance(userLat, userLng, store.latitude, store.longitude);
      }
      
      const avg = store.reviews.length > 0
        ? store.reviews.reduce((acc, curr) => acc + curr.rating, 0) / store.reviews.length
        : store.rating;

      return { 
        ...store, 
        distance,
        averageRating: Number(avg.toFixed(1)),
        totalReviews: store.reviews.length,
        isSellerProfile: false
      };
    });

    // Query seller profiles
    const hasCoordinates = !isNaN(userLat) && !isNaN(userLng);
    let profiles = [];
    let usedRecentFallback = false;

    if (hasCoordinates) {
      const profileFilter = {
        latitude: { not: null },
        longitude: { not: null }
      };
      if (category) {
        profileFilter.businessCategory = category;
      }

      const tempProfiles = await prisma.profile.findMany({
        where: profileFilter,
        include: {
          reviews: true
        }
      });

      // Map profiles and calculate distance
      const profilesWithDistance = tempProfiles.map(profile => {
        const distance = calculateDistance(userLat, userLng, profile.latitude, profile.longitude);
        const avg = profile.reviews.length > 0
          ? profile.reviews.reduce((acc, curr) => acc + curr.rating, 0) / profile.reviews.length
          : 5.0;
        return {
          id: -profile.userId,
          name: profile.displayName || profile.fullName,
          category: profile.businessCategory,
          imagePath: profile.imagePath || null,
          location: profile.location || "",
          latitude: profile.latitude,
          longitude: profile.longitude,
          rating: avg,
          contact: profile.whatsAppNumber || profile.mobileNumber || "",
          createdAt: new Date(), // fallback
          distance,
          averageRating: Number(avg.toFixed(1)),
          totalReviews: profile.reviews.length,
          isSellerProfile: true
        };
      });

      // Filter to nearby profiles (e.g., within 50 km)
      const nearbyProfiles = profilesWithDistance.filter(p => p.distance <= 50);

      if (nearbyProfiles.length > 0) {
        profiles = nearbyProfiles;
      } else {
        usedRecentFallback = true;
      }
    } else {
      usedRecentFallback = true;
    }

    if (usedRecentFallback) {
      const fallbackFilter = {};
      if (category) {
        fallbackFilter.businessCategory = category;
      }

      const recentProfiles = await prisma.profile.findMany({
        where: fallbackFilter,
        orderBy: {
          id: 'desc'
        },
        take: 10,
        include: {
          reviews: true
        }
      });

      profiles = recentProfiles.map(profile => {
        const avg = profile.reviews.length > 0
          ? profile.reviews.reduce((acc, curr) => acc + curr.rating, 0) / profile.reviews.length
          : 5.0;
        return {
          id: -profile.userId,
          name: profile.displayName || profile.fullName,
          category: profile.businessCategory,
          imagePath: profile.imagePath || null,
          location: profile.location || "",
          latitude: profile.latitude,
          longitude: profile.longitude,
          rating: avg,
          contact: profile.whatsAppNumber || profile.mobileNumber || "",
          createdAt: new Date(),
          distance: null, // no distance
          averageRating: Number(avg.toFixed(1)),
          totalReviews: profile.reviews.length,
          isSellerProfile: true,
          isRecentFallback: true
        };
      });
    }

    // Combine stores and seller profiles
    const combined = [...mappedStores, ...profiles];

    if (hasCoordinates) {
      combined.sort((a, b) => {
        if (a.distance === null && b.distance === null) return 0;
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (!isNaN(pageNum) && !isNaN(limitNum)) {
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = pageNum * limitNum;
      res.json(combined.slice(startIndex, endIndex));
    } else {
      res.json(combined);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get nearby services (filtered by type, sorted by distance)
app.get('/api/services', async (req, res) => {
  try {
    const { lat, lng, serviceType, page, limit } = req.query;

    const filter = {
      listingType: "SERVICES",
      status: "ACTIVE"
    };

    if (serviceType) {
      filter.OR = [
        { category: { name: { contains: serviceType, mode: 'insensitive' } } },
        { subCategory: { name: { contains: serviceType, mode: 'insensitive' } } }
      ];
    }

    const listings = await prisma.listing.findMany({
      where: filter,
      include: {
        category: true,
        subCategory: true,
        seller: {
          select: { username: true, emailVerified: true }
        },
        reviews: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    const mapped = listings.map(l => {
      let distance = null;
      if (!isNaN(userLat) && !isNaN(userLng) && l.latitude && l.longitude) {
        distance = calculateDistance(userLat, userLng, l.latitude, l.longitude);
      }

      const avg = l.reviews.length > 0
        ? l.reviews.reduce((acc, curr) => acc + curr.rating, 0) / l.reviews.length
        : 0;

      let firstImage = null;
      if (l.imagePath) {
        const parts = l.imagePath.split(',');
        if (parts.length > 0) {
          firstImage = parts[0].trim();
        }
      }

      return {
        id: l.id,
        name: l.title,
        serviceType: l.subCategory?.name || l.category?.name || "Service",
        categoryName: l.category?.name || "",
        imagePath: firstImage,
        location: l.location,
        latitude: l.latitude,
        longitude: l.longitude,
        price: l.price,
        rating: avg || 5.0,
        averageRating: avg || 5.0,
        totalReviews: l.reviews.length,
        contact: l.whatsappNumber || l.contactNumber || null,
        distance,
        verified: l.seller?.emailVerified || false,
        createdAt: l.createdAt
      };
    });

    if (!isNaN(userLat) && !isNaN(userLng)) {
      mapped.sort((a, b) => {
        if (a.distance === null && b.distance === null) return 0;
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (!isNaN(pageNum) && !isNaN(limitNum)) {
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = pageNum * limitNum;
      res.json(mapped.slice(startIndex, endIndex));
    } else {
      res.json(mapped);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific store's detail, reviews, and related listings
app.get('/api/stores/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { lat, lng } = req.query;

    if (id < 0) {
      const userId = Math.abs(id);
      const profile = await prisma.profile.findUnique({
        where: { userId },
        include: {
          reviews: {
            include: {
              buyer: {
                select: { username: true }
              }
            },
            orderBy: {
              createdAt: 'desc'
            }
          }
        }
      });
      if (!profile) return res.status(404).json({ error: "Seller profile not found" });

      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      let distance = null;
      if (!isNaN(userLat) && !isNaN(userLng) && profile.latitude && profile.longitude) {
        distance = calculateDistance(userLat, userLng, profile.latitude, profile.longitude);
      }

      // Related listings: ACTIVE listings owned by this seller
      const relatedListings = await prisma.listing.findMany({
        where: {
          sellerId: userId,
          status: "ACTIVE"
        },
        include: {
          category: true,
          subCategory: true,
          reviews: {
            select: { rating: true }
          }
        },
        take: 6
      });

      const avg = profile.reviews.length > 0
        ? profile.reviews.reduce((acc, curr) => acc + curr.rating, 0) / profile.reviews.length
        : 5.0;

      const enrichedStore = {
        id: -profile.userId,
        name: profile.displayName || profile.fullName,
        category: profile.businessCategory,
        imagePath: profile.imagePath || null,
        location: profile.location || "",
        latitude: profile.latitude,
        longitude: profile.longitude,
        rating: avg,
        contact: profile.whatsAppNumber || profile.mobileNumber || "",
        about: profile.aboutSeller,
        professionalTitle: profile.professionalTitle,
        yearsOfExperience: profile.yearsOfExperience,
        email: profile.email,
        distance,
        averageRating: Number(avg.toFixed(1)),
        totalReviews: profile.reviews.length,
        reviews: profile.reviews,
        isSellerProfile: true
      };

      return res.json({ store: enrichedStore, relatedListings });
    }

    const store = await prisma.store.findUnique({
      where: { id },
      include: {
        reviews: {
          include: {
            buyer: {
              select: { username: true }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });
    if (!store) return res.status(404).json({ error: "Store not found" });

    // Calculate distance
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    let distance = null;
    if (!isNaN(userLat) && !isNaN(userLng) && store.latitude && store.longitude) {
      distance = calculateDistance(userLat, userLng, store.latitude, store.longitude);
    }

    // Related listings: ACTIVE listings in the same city/location
    const relatedListings = await prisma.listing.findMany({
      where: {
        location: { contains: store.location, mode: 'insensitive' },
        status: "ACTIVE"
      },
      include: {
        category: true,
        subCategory: true,
        reviews: {
          select: { rating: true }
        }
      },
      take: 6
    });

    const avg = store.reviews.length > 0
      ? store.reviews.reduce((acc, curr) => acc + curr.rating, 0) / store.reviews.length
      : store.rating;

    const enrichedStore = {
      ...store,
      distance,
      averageRating: Number(avg.toFixed(1)),
      totalReviews: store.reviews.length,
      isSellerProfile: false
    };

    res.json({ store: enrichedStore, relatedListings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific service's detail, reviews, and related listings
app.get('/api/services/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { lat, lng } = req.query;

    const listing = await prisma.listing.findFirst({
      where: { id, listingType: "SERVICES" },
      include: {
        category: true,
        subCategory: true,
        seller: {
          select: { username: true, emailVerified: true }
        },
        reviews: {
          include: {
            buyer: {
              select: { username: true }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });
    if (!listing) return res.status(404).json({ error: "Service not found" });

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    let distance = null;
    if (!isNaN(userLat) && !isNaN(userLng) && listing.latitude && listing.longitude) {
      distance = calculateDistance(userLat, userLng, listing.latitude, listing.longitude);
    }

    const relatedListings = await prisma.listing.findMany({
      where: {
        location: { contains: listing.location, mode: 'insensitive' },
        status: "ACTIVE"
      },
      include: {
        category: true,
        subCategory: true,
        reviews: {
          select: { rating: true }
        }
      },
      take: 6
    });

    const avg = listing.reviews.length > 0
      ? listing.reviews.reduce((acc, curr) => acc + curr.rating, 0) / listing.reviews.length
      : 5.0;

    let firstImage = null;
    if (listing.imagePath) {
      const parts = listing.imagePath.split(',');
      if (parts.length > 0) {
        firstImage = parts[0].trim();
      }
    }

    const enrichedService = {
      id: listing.id,
      name: listing.title,
      serviceType: listing.subCategory?.name || listing.category?.name || "Service",
      imagePath: firstImage,
      location: listing.location,
      latitude: listing.latitude,
      longitude: listing.longitude,
      rating: avg,
      averageRating: avg,
      totalReviews: listing.reviews.length,
      reviews: listing.reviews.map(r => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        buyer: r.buyer
      })),
      contact: listing.whatsappNumber || listing.contactNumber || null,
      distance
    };

    res.json({ service: enrichedService, relatedListings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Store (Admin/Editor Only)
app.post('/api/stores', authenticateToken, requireRole(['ADMIN', 'EDITOR']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const { name, category, location, latitude, longitude, rating, contact } = req.body;
    if (!name) return res.status(400).json({ error: "Store name is required." });
    if (!category) return res.status(400).json({ error: "Store category is required." });
    if (!location) return res.status(400).json({ error: "Store location is required." });

    const imagePath = req.file ? req.file.path : null;

    const newStore = await prisma.store.create({
      data: {
        name,
        category,
        imagePath,
        location,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        rating: rating ? parseFloat(rating) : 5.0,
        contact: contact || null
      }
    });
    res.status(201).json(newStore);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Store (Admin/Editor Only)
app.put('/api/stores/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, category, location, latitude, longitude, rating, contact, imagePath } = req.body;
    if (!name) return res.status(400).json({ error: "Store name is required." });
    if (!category) return res.status(400).json({ error: "Store category is required." });
    if (!location) return res.status(400).json({ error: "Store location is required." });

    const updateData = {
      name,
      category,
      location,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      rating: rating ? parseFloat(rating) : 5.0,
      contact: contact || null
    };

    if (req.file) {
      updateData.imagePath = req.file.path;
    } else if (imagePath === null || imagePath === "null" || imagePath === "") {
      updateData.imagePath = null;
    }

    const updatedStore = await prisma.store.update({
      where: { id },
      data: updateData
    });
    res.json(updatedStore);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Store (Admin/Editor Only)
app.delete('/api/stores/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.store.delete({ where: { id } });
    res.json({ message: "Store deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Service (Admin/Editor Only)
app.post('/api/services', authenticateToken, requireRole(['ADMIN', 'EDITOR']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const { name, serviceType, icon, location, latitude, longitude, rating, contact } = req.body;
    if (!name) return res.status(400).json({ error: "Service name is required." });
    if (!serviceType) return res.status(400).json({ error: "Service type is required." });
    if (!location) return res.status(400).json({ error: "Service location is required." });

    const imagePath = req.file ? req.file.path : null;

    const newService = await prisma.service.create({
      data: {
        name,
        serviceType,
        icon: icon || "🛠️",
        imagePath,
        location,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        rating: rating ? parseFloat(rating) : 5.0,
        contact: contact || null
      }
    });
    res.status(201).json(newService);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Service (Admin/Editor Only)
app.put('/api/services/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, serviceType, icon, location, latitude, longitude, rating, contact, imagePath } = req.body;
    if (!name) return res.status(400).json({ error: "Service name is required." });
    if (!serviceType) return res.status(400).json({ error: "Service type is required." });
    if (!location) return res.status(400).json({ error: "Service location is required." });

    const updateData = {
      name,
      serviceType,
      icon: icon || "🛠️",
      location,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      rating: rating ? parseFloat(rating) : 5.0,
      contact: contact || null
    };

    if (req.file) {
      updateData.imagePath = req.file.path;
    } else if (imagePath === null || imagePath === "null" || imagePath === "") {
      updateData.imagePath = null;
    }

    const updatedService = await prisma.service.update({
      where: { id },
      data: updateData
    });
    res.json(updatedService);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Service (Admin/Editor Only)
app.delete('/api/services/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.service.delete({ where: { id } });
    res.json({ message: "Service deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a review to a store
app.post('/api/stores/:id/reviews', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rating, comment } = req.body;
    const buyerId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    if (id < 0) {
      const userId = Math.abs(id);
      const profile = await prisma.profile.findUnique({
        where: { userId }
      });
      if (!profile) return res.status(404).json({ error: "Seller profile not found" });

      const newReview = await prisma.review.create({
        data: {
          profileId: profile.id,
          buyerId,
          rating: parseInt(rating),
          comment: comment || ""
        },
        include: {
          buyer: {
            select: { username: true }
          }
        }
      });
      return res.status(201).json(newReview);
    }

    const newReview = await prisma.review.create({
      data: {
        storeId: id,
        buyerId,
        rating: parseInt(rating),
        comment: comment || ""
      },
      include: {
        buyer: {
          select: { username: true }
        }
      }
    });

    // Update overall average rating in Store model
    const allReviews = await prisma.review.findMany({
      where: { storeId: id }
    });
    const avgRating = allReviews.reduce((acc, curr) => acc + curr.rating, 0) / allReviews.length;
    await prisma.store.update({
      where: { id },
      data: { rating: parseFloat(avgRating.toFixed(1)) }
    });

    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a review to a service
app.post('/api/services/:id/reviews', authenticateToken, async (req, res) => {
  try {
    const serviceId = parseInt(req.params.id);
    const { rating, comment } = req.body;
    const buyerId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    const newReview = await prisma.review.create({
      data: {
        listingId: serviceId,
        buyerId,
        rating: parseInt(rating),
        comment: comment || ""
      },
      include: {
        buyer: {
          select: { username: true }
        }
      }
    });

    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 3. LISTINGS & GLOBAL SEARCH

app.get('/api/listings', async (req, res) => {
  try {
    const { q, categoryId, subCategoryId, minPrice, maxPrice, location, status, discountOnly, sellerId, dateFilter, sortBy, lat, lng, listingType, ids } = req.query;

    const filters = {};

    if (ids) {
      const idArray = ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
      filters.id = { in: idArray };
    }

    if (sellerId) {
      filters.sellerId = parseInt(sellerId);
    }

    if (listingType) {
      filters.listingType = listingType;
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

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    let mappedListings = enrichedListings.map(l => {
      let distance = null;
      if (!isNaN(userLat) && !isNaN(userLng) && l.latitude && l.longitude) {
        distance = calculateDistance(userLat, userLng, l.latitude, l.longitude);
      }
      return { ...l, distance };
    });

    if (sortBy === 'distance_asc' && !isNaN(userLat) && !isNaN(userLng)) {
      mappedListings.sort((a, b) => {
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });
    }

    // Paginate manually after sorting by distance or date!
    const pageNum = parseInt(req.query.page);
    const limitNum = parseInt(req.query.limit);
    if (!isNaN(pageNum) && !isNaN(limitNum)) {
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = pageNum * limitNum;
      res.json(mappedListings.slice(startIndex, endIndex));
    } else {
      res.json(mappedListings);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Listing (Seller / Admin / Editor Only)
app.post('/api/listings', authenticateToken, requireRole(['SELLER', 'ADMIN', 'EDITOR']), upload.any(), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const { title, description, price, priceMax, listingType, discountPercent, location, whatsappNumber, contactNumber, categoryId, subCategoryId } = req.body;

    if (!title || !description || !price || !location || !whatsappNumber || !contactNumber || !categoryId) {
      return res.status(400).json({ error: "Required fields are missing." });
    }

    let imagePath = null;
    if (req.body.imageUrls) {
      imagePath = req.body.imageUrls;
    } else if (req.files && req.files.length > 0) {
      imagePath = req.files.map(file => file.path).join(',');
    }

    const listing = await prisma.listing.create({
      data: {
        title,
        description,
        price: parseFloat(price),
        priceMax: priceMax ? parseFloat(priceMax) : null,
        listingType: listingType || "SALES",
        discountPercent: parseFloat(discountPercent || 0),
        location,
        whatsappNumber,
        contactNumber,
        imagePath,
        sellerId: req.user.id,
        categoryId: parseInt(categoryId),
        subCategoryId: subCategoryId ? parseInt(subCategoryId) : null,
        status: (req.user.role !== 'ADMIN' && req.user.role !== 'EDITOR') ? 'PENDING' : 'ACTIVE' // Standard users need approval, admins/editors auto-approve
      }
    });

    io.emit('listings_update', { action: 'create', listing });

    await promoteListingImages(imagePath);

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
        seller: { select: { id: true, username: true, phoneNumber: true, whatsappNumber: true, profile: true } },
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

    io.emit('listings_update', { action: 'update', listing: updatedListing });

    res.json(updatedListing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Listing Details (Admin/Editor or Seller Owner)
app.put('/api/listings/:id', authenticateToken, requireRole(['ADMIN', 'EDITOR', 'SELLER']), upload.any(), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const listingId = parseInt(req.params.id);
    const { title, description, price, priceMax, listingType, discountPercent, location, whatsappNumber, contactNumber, categoryId, subCategoryId } = req.body;

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    // Validate ownership if seller
    if (req.user.role === 'SELLER' && listing.sellerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden: You do not own this listing." });
    }

    let imagePaths = undefined;
    if (req.body.imageUrls !== undefined) {
      imagePaths = req.body.imageUrls;
    } else if (req.files && req.files.length > 0) {
      imagePaths = req.files.map(file => file.path).join(',');
    }

    const updatedData = {};
    if (imagePaths !== undefined) updatedData.imagePath = imagePaths;
    if (title !== undefined) updatedData.title = title;
    if (description !== undefined) updatedData.description = description;
    if (price !== undefined) updatedData.price = parseFloat(price);
    if (priceMax !== undefined) updatedData.priceMax = priceMax ? parseFloat(priceMax) : null;
    if (listingType !== undefined) updatedData.listingType = listingType;
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

    io.emit('listings_update', { action: 'update', listing: updatedListing });

    if (imagePaths) {
      await promoteListingImages(imagePaths);
    }

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
    io.emit('listings_update', { action: 'delete', id: listingId });
    res.json({ message: "Listing deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 4. REVIEWS & RATINGS

// Submit Review with Multi-Media (Buyer / Admin / Editor Only)
app.post('/api/listings/:id/reviews', authenticateToken, requireRole(['BUYER', 'ADMIN', 'EDITOR']), upload.fields([{ name: 'images', maxCount: 5 }, { name: 'videos', maxCount: 2 }]), optimizeImagesMiddleware, async (req, res) => {
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
    const userId = req.user.id;
    const inquiries = await prisma.inquiry.findMany({
      where: {
        listing: { sellerId: userId }
      },
      include: {
        buyer: { select: { id: true, username: true, phoneNumber: true, whatsappNumber: true } },
        listing: { select: { id: true, title: true, price: true, sellerId: true } },
        messages: {
          include: {
            sender: { select: { id: true, username: true, role: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    const formatted = await Promise.all(inquiries.map(async (inq) => {
      let msgs = [...inq.messages];
      if (msgs.length === 0) {
        msgs.push({
          id: `legacy-buyer-${inq.id}`,
          inquiryId: inq.id,
          senderId: inq.buyerId,
          sender: { id: inq.buyerId, username: inq.buyer?.username || 'Buyer', role: 'BUYER' },
          text: inq.message,
          createdAt: inq.createdAt
        });
        if (inq.replyMessage) {
          msgs.push({
            id: `legacy-seller-${inq.id}`,
            inquiryId: inq.id,
            senderId: userId,
            sender: { id: userId, username: req.user.username, role: 'SELLER' },
            text: inq.replyMessage,
            createdAt: inq.createdAt
          });
        }
      }

      const latestMessage = msgs[msgs.length - 1];

      // Calculate unread count (messages sent by other user in this conversation)
      const unreadCount = inq.status === "READ" ? 0 : await prisma.message.count({
        where: {
          inquiryId: inq.id,
          senderId: { not: userId }
        }
      });

      return {
        ...inq,
        latestMessage,
        unreadCount,
        messages: [latestMessage]
      };
    }));

    // Sort by latest message timestamp DESC
    formatted.sort((a, b) => {
      const timeA = new Date(a.latestMessage?.createdAt || a.createdAt).getTime();
      const timeB = new Date(b.latestMessage?.createdAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Inquiries Sent by a Buyer (Buyer dashboard history)
app.get('/api/inquiries/buyer', authenticateToken, requireRole(['BUYER', 'ADMIN']), async (req, res) => {
  try {
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
            seller: { select: { id: true, username: true, phoneNumber: true, whatsappNumber: true } }
          }
        },
        messages: {
          include: {
            sender: { select: { id: true, username: true, role: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    const formatted = await Promise.all(inquiries.map(async (inq) => {
      let msgs = [...inq.messages];
      if (msgs.length === 0) {
        msgs.push({
          id: `legacy-buyer-${inq.id}`,
          inquiryId: inq.id,
          senderId: inq.buyerId,
          sender: { id: inq.buyerId, username: req.user.username, role: 'BUYER' },
          text: inq.message,
          createdAt: inq.createdAt
        });
        if (inq.replyMessage) {
          msgs.push({
            id: `legacy-seller-${inq.id}`,
            inquiryId: inq.id,
            senderId: inq.listing.sellerId,
            sender: { id: inq.listing.sellerId, username: inq.listing.seller?.username || 'Seller', role: 'SELLER' },
            text: inq.replyMessage,
            createdAt: inq.createdAt
          });
        }
      }

      const latestMessage = msgs[msgs.length - 1];

      // Calculate unread count (messages sent by other user in this conversation)
      const unreadCount = inq.status === "READ" ? 0 : await prisma.message.count({
        where: {
          inquiryId: inq.id,
          senderId: { not: userId }
        }
      });

      return {
        ...inq,
        latestMessage,
        unreadCount,
        messages: [latestMessage]
      };
    }));

    // Sort by latest message timestamp DESC
    formatted.sort((a, b) => {
      const timeA = new Date(a.latestMessage?.createdAt || a.createdAt).getTime();
      const timeB = new Date(b.latestMessage?.createdAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reply / Send Message in Inquiry Chat Thread (Both Buyer & Seller)
app.post('/api/inquiries/:id/message', authenticateToken, async (req, res) => {
  try {
    const inquiryId = parseInt(req.params.id);
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Message text is required." });

    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: { listing: true }
    });

    if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });

    const isBuyer = inquiry.buyerId === req.user.id;
    const isSeller = inquiry.listing.sellerId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({ error: "Forbidden: You are not a participant in this conversation." });
    }

    const newMessage = await prisma.message.create({
      data: {
        inquiryId,
        senderId: req.user.id,
        text: text.trim()
      },
      include: {
        sender: { select: { id: true, username: true, role: true } }
      }
    });

    // Update status on inquiry
    await prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        status: isSeller ? "REPLIED" : "UNREAD"
      }
    });

    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start or Get existing Direct Chat Session for a product listing
app.post('/api/chats/start', authenticateToken, async (req, res) => {
  try {
    const { listingId, initialMessage } = req.body;
    if (!listingId) return res.status(400).json({ error: "Listing ID is required." });

    const listing = await prisma.listing.findUnique({
      where: { id: parseInt(listingId) },
      include: { seller: true }
    });

    if (!listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.sellerId === req.user.id) {
      return res.status(400).json({ error: "You cannot start a chat with yourself on your own listing." });
    }

    // Check if an inquiry already exists between this buyer and listing
    let inquiry = await prisma.inquiry.findFirst({
      where: {
        listingId: listing.id,
        buyerId: req.user.id
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
            seller: { select: { id: true, username: true, profile: true } }
          }
        },
        messages: {
          include: {
            sender: { select: { id: true, username: true, role: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!inquiry) {
      const firstMsgText = initialMessage && initialMessage.trim() ? initialMessage.trim() : `Hi! Is "${listing.title}" available?`;
      inquiry = await prisma.inquiry.create({
        data: {
          listingId: listing.id,
          buyerId: req.user.id,
          message: firstMsgText,
          messages: {
            create: {
              senderId: req.user.id,
              text: firstMsgText
            }
          }
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
              seller: { select: { id: true, username: true, profile: true } }
            }
          },
          messages: {
            include: {
              sender: { select: { id: true, username: true, role: true } }
            },
            orderBy: { createdAt: 'asc' }
          }
        }
      });
    }

    res.json(inquiry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get All Active Chats for the Logged In User
app.get('/api/chats/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const inquiries = await prisma.inquiry.findMany({
      where: {
        OR: [
          { buyerId: userId },
          { listing: { sellerId: userId } }
        ]
      },
      include: {
        buyer: { select: { id: true, username: true, phoneNumber: true, whatsappNumber: true } },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            imagePath: true,
            sellerId: true,
            seller: { select: { id: true, username: true, phoneNumber: true, whatsappNumber: true, profile: true } }
          }
        },
        messages: {
          include: {
            sender: { select: { id: true, username: true, role: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    const formatted = await Promise.all(inquiries.map(async (inq) => {
      let msgs = [...inq.messages];
      if (msgs.length === 0) {
        msgs.push({
          id: `legacy-buyer-${inq.id}`,
          inquiryId: inq.id,
          senderId: inq.buyerId,
          sender: { id: inq.buyerId, username: inq.buyer?.username || 'Buyer', role: 'BUYER' },
          text: inq.message,
          createdAt: inq.createdAt
        });
        if (inq.replyMessage) {
          msgs.push({
            id: `legacy-seller-${inq.id}`,
            inquiryId: inq.id,
            senderId: inq.listing?.sellerId,
            sender: { id: inq.listing?.sellerId, username: inq.listing?.seller?.username || 'Seller', role: 'SELLER' },
            text: inq.replyMessage,
            createdAt: inq.createdAt
          });
        }
      }

      const latestMessage = msgs[msgs.length - 1];

      // Calculate unread count (messages sent by other user in this conversation)
      const unreadCount = inq.status === "READ" ? 0 : await prisma.message.count({
        where: {
          inquiryId: inq.id,
          senderId: { not: userId }
        }
      });

      const otherUserRaw = inq.buyerId === userId 
        ? { 
            id: inq.listing?.sellerId, 
            name: inq.listing?.seller?.profile?.displayName || inq.listing?.seller?.username?.split('@')[0] || 'Seller', 
            phoneNumber: inq.listing?.seller?.phoneNumber || inq.listing?.seller?.whatsappNumber || '',
            role: 'SELLER' 
          }
        : { 
            id: inq.buyerId, 
            name: inq.buyer?.username?.split('@')[0] || 'Buyer', 
            phoneNumber: inq.buyer?.phoneNumber || inq.buyer?.whatsappNumber || '',
            role: 'BUYER' 
          };

      // Mock isOnline indicator
      const otherUser = {
        ...otherUserRaw,
        isOnline: (otherUserRaw.id % 3 !== 0)
      };

      return {
        ...inq,
        otherUser,
        latestMessage,
        unreadCount,
        messages: [latestMessage]
      };
    }));

    // Sort by latest message timestamp DESC
    formatted.sort((a, b) => {
      const timeA = new Date(a.latestMessage?.createdAt || a.createdAt).getTime();
      const timeB = new Date(b.latestMessage?.createdAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Messages for a specific Inquiry/Conversation
app.get('/api/inquiries/:id/messages', authenticateToken, async (req, res) => {
  try {
    const inquiryId = parseInt(req.params.id);
    const userId = req.user.id;

    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: { listing: true }
    });

    if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });

    if (inquiry.buyerId !== userId && inquiry.listing.sellerId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Forbidden: You are not a participant in this conversation." });
    }

    const messages = await prisma.message.findMany({
      where: { inquiryId },
      include: {
        sender: { select: { id: true, username: true, role: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Support legacy messages if messages relation is empty
    let msgs = [...messages];
    if (msgs.length === 0) {
      msgs.push({
        id: `legacy-buyer-${inquiry.id}`,
        inquiryId: inquiry.id,
        senderId: inquiry.buyerId,
        sender: { id: inquiry.buyerId, username: 'Buyer', role: 'BUYER' },
        text: inquiry.message,
        createdAt: inquiry.createdAt
      });
      if (inquiry.replyMessage) {
        msgs.push({
          id: `legacy-seller-${inquiry.id}`,
          inquiryId: inquiry.id,
          senderId: inquiry.listing.sellerId,
          sender: { id: inquiry.listing.sellerId, username: 'Seller', role: 'SELLER' },
          text: inquiry.replyMessage,
          createdAt: inquiry.createdAt
        });
      }
    }

    res.json(msgs);
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

    // Emit real-time Socket.IO message
    io.to(`inquiry_${inquiryId}`).emit('receive_message', newMessage);

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

// --- ADMIN SELLER PROFILE ROUTING ---

// Get all seller profiles (Admin/Editor Only)
app.get('/api/admin/seller-profiles', authenticateToken, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  try {
    const profiles = await prisma.profile.findMany({
      include: {
        user: {
          select: {
            username: true,
            role: true
          }
        }
      },
      orderBy: {
        id: 'desc'
      }
    });
    res.json(profiles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete seller profile (Admin Only)
app.delete('/api/admin/seller-profiles/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.profile.delete({
      where: { id }
    });
    res.json({ message: "Seller profile deleted successfully." });
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
app.post('/api/cities', authenticateToken, requireRole(['ADMIN']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: "City name is required." });
    
    // Check if city already exists
    const existing = await prisma.city.findUnique({ where: { name } });
    if (existing) return res.status(400).json({ error: "City already exists." });

    const imagePath = req.file ? req.file.path : null;

    const city = await prisma.city.create({
      data: {
        name,
        emoji: emoji || "📍",
        imagePath
      }
    });
    res.status(201).json(city);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "A city with this name already exists." });
    }
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
app.put('/api/cities/:id', authenticateToken, requireRole(['ADMIN']), imageUpload.single('image'), optimizeImagesMiddleware, autoUploadMulterToS3, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, emoji, imagePath } = req.body;
    if (!name) return res.status(400).json({ error: "City name is required." });
    
    const updateData = { name, emoji: emoji || "📍" };
    if (req.file) {
      updateData.imagePath = req.file.path;
    } else if (imagePath === null || imagePath === "null" || imagePath === "") {
      updateData.imagePath = null;
    }

    const updated = await prisma.city.update({
      where: { id: parseInt(id, 10) },
      data: updateData
    });
    res.json(updated);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "A city with this name already exists." });
    }
    res.status(500).json({ error: error.message });
  }
});

// Start Server
server.listen(PORT, () => {
  console.log(`lowpriceplaces API Server running on port ${PORT}`);
});
