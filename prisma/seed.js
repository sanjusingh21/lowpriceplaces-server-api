const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Create Users
  const salt = bcrypt.genSaltSync(10);
  
  const adminPassword = bcrypt.hashSync("admin123", salt);
  const editorPassword = bcrypt.hashSync("editor123", salt);
  const seoPassword = bcrypt.hashSync("seo123", salt);
  const sellerPassword = bcrypt.hashSync("seller123", salt);
  const buyerPassword = bcrypt.hashSync("buyer123", salt);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      password: adminPassword,
      role: "ADMIN",
      phoneNumber: "9876543210",
      whatsappNumber: "9876543210"
    }
  });

  const editor = await prisma.user.upsert({
    where: { username: "editor" },
    update: {},
    create: {
      username: "editor",
      password: editorPassword,
      role: "EDITOR",
      phoneNumber: "9876543211",
      whatsappNumber: "9876543211"
    }
  });

  const seo = await prisma.user.upsert({
    where: { username: "seo" },
    update: {},
    create: {
      username: "seo",
      password: seoPassword,
      role: "SEO",
      phoneNumber: "9876543212",
      whatsappNumber: "9876543212"
    }
  });

  const seller = await prisma.user.upsert({
    where: { username: "seller" },
    update: {},
    create: {
      username: "seller",
      password: sellerPassword,
      role: "SELLER",
      phoneNumber: "9876543213",
      whatsappNumber: "9876543213"
    }
  });

  const buyer = await prisma.user.upsert({
    where: { username: "buyer" },
    update: {},
    create: {
      username: "buyer",
      password: buyerPassword,
      role: "BUYER",
      phoneNumber: "9876543214",
      whatsappNumber: "9876543214"
    }
  });

  console.log("Users seeded successfully.");

  // 2. Create Categories & SubCategories
  const categoriesData = [
    {
      name: "Electronics",
      slug: "electronics",
      subCategories: [
        { name: "Mobile Phones", slug: "mobile-phones" },
        { name: "Laptops", slug: "laptops" },
        { name: "Cameras", slug: "cameras" }
      ]
    },
    {
      name: "Vehicles",
      slug: "vehicles",
      subCategories: [
        { name: "Cars", slug: "cars" },
        { name: "Motorcycles", slug: "motorcycles" },
        { name: "Bicycles", slug: "bicycles" }
      ]
    },
    {
      name: "Property",
      slug: "property",
      subCategories: [
        { name: "Apartments", slug: "apartments" },
        { name: "Houses", slug: "houses" },
        { name: "Land", slug: "land" }
      ]
    }
  ];

  for (const cat of categoriesData) {
    const category = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: {
        name: cat.name,
        slug: cat.slug
      }
    });

    for (const sub of cat.subCategories) {
      await prisma.subCategory.upsert({
        where: { slug: sub.slug },
        update: {},
        create: {
          name: sub.name,
          slug: sub.slug,
          categoryId: category.id
        }
      });
    }
  }

  console.log("Categories & Subcategories seeded.");

  // Fetch created categories and subcategories
  const electronics = await prisma.category.findUnique({ where: { slug: "electronics" } });
  const mobiles = await prisma.subCategory.findUnique({ where: { slug: "mobile-phones" } });
  const laptops = await prisma.subCategory.findUnique({ where: { slug: "laptops" } });

  const vehicles = await prisma.category.findUnique({ where: { slug: "vehicles" } });
  const cars = await prisma.subCategory.findUnique({ where: { slug: "cars" } });

  // 3. Create Sample Listings
  const listing1 = await prisma.listing.create({
    data: {
      title: "iPhone 15 Pro Max - 256GB - Titanium",
      description: "Brand new iPhone 15 Pro Max, sealed box. Local warranty available. Space Titanium color. Premium condition.",
      price: 1199,
      discountPercent: 10,
      location: "San Jose, CA",
      whatsappNumber: "14085551234",
      contactNumber: "14085551234",
      status: "ACTIVE", // Already approved
      sellerId: seller.id,
      categoryId: electronics.id,
      subCategoryId: mobiles.id,
      imagePath: "/uploads/sample-iphone.jpg"
    }
  });

  const listing2 = await prisma.listing.create({
    data: {
      title: "Tesla Model 3 Highland 2024",
      description: "Mint condition Tesla Model 3 Long Range with FSD. Red Multi-Coat. Garaged, low mileage. Price negotiable.",
      price: 39500,
      discountPercent: 5,
      location: "Los Angeles, CA",
      whatsappNumber: "12135559876",
      contactNumber: "12135559876",
      status: "ACTIVE",
      sellerId: seller.id,
      categoryId: vehicles.id,
      subCategoryId: cars.id,
      imagePath: "/uploads/sample-tesla.jpg"
    }
  });

  const listing3 = await prisma.listing.create({
    data: {
      title: "MacBook Pro 16 M3 Max",
      description: "Unopened MacBook Pro M3 Max. 36GB RAM, 1TB SSD. Space Black. Gifted, but not needed.",
      price: 2899,
      discountPercent: 15,
      location: "San Francisco, CA",
      whatsappNumber: "14155556666",
      contactNumber: "14155556666",
      status: "PENDING", // Needs Admin/Editor approval
      sellerId: seller.id,
      categoryId: electronics.id,
      subCategoryId: laptops.id,
      imagePath: "/uploads/sample-macbook.jpg"
    }
  });

  console.log("Sample listings seeded.");

  // 4. Create Sample Reviews
  await prisma.review.create({
    data: {
      listingId: listing1.id,
      buyerId: buyer.id,
      rating: 5,
      comment: "Seller was super responsive and the iPhone was exactly as described! Sealed box. High recommendation.",
      images: ["/uploads/review-iphone1.jpg"],
      videos: []
    }
  });

  await prisma.review.create({
    data: {
      listingId: listing1.id,
      buyerId: admin.id, // Admin as a buyer test
      rating: 4,
      comment: "Good transaction. Met at a public coffee shop. Product works flawlessly.",
      images: [],
      videos: []
    }
  });

  await prisma.review.create({
    data: {
      listingId: listing2.id,
      buyerId: buyer.id,
      rating: 5,
      comment: "Beautiful Tesla! Took a test drive. Smooth transaction and documents transferred quickly.",
      images: ["/uploads/review-tesla1.jpg"],
      videos: ["/uploads/review-tesla-drive.mp4"]
    }
  });

  console.log("Sample reviews seeded.");

  // 5. Create Sample SEO Meta Tag Info
  await prisma.sEOMeta.create({
    data: {
      routePath: "/",
      titleTag: "Glassify Classifieds - Buy & Sell Anything Near You",
      metaDescription: "Glassify Classifieds is the premier premium dark-glass marketplace. Buy and sell laptops, cars, apartments, and more with instant WhatsApp connect.",
      keywords: "classifieds, marketplace, buy, sell, electronics, vehicles, discount, local listing"
    }
  });

  await prisma.sEOMeta.create({
    data: {
      routePath: `/listings/${listing1.id}`,
      titleTag: "Buy iPhone 15 Pro Max Titanium - Glassify Classifieds",
      metaDescription: "Get the best deal on a brand new iPhone 15 Pro Max. space titanium, sealed, CA. Contact via WhatsApp now.",
      keywords: "iphone 15 pro max, titanium iphone, cheap iphone, california electronics"
    }
  });

  console.log("SEO Metadata seeded.");

  // 6. Seed default Cities
  const defaultCities = [
    { name: "Mumbai", emoji: "🏙️" },
    { name: "Delhi", emoji: "🏛️" },
    { name: "Bangalore", emoji: "💻" },
    { name: "Hyderabad", emoji: "🍛" },
    { name: "Ahmedabad", emoji: "☀️" },
    { name: "Chennai", emoji: "🏖️" },
    { name: "Kolkata", emoji: "🌉" },
    { name: "Pune", emoji: "⛰️" },
    { name: "Jaipur", emoji: "🏯" },
    { name: "Lucknow", emoji: "🏛️" }
  ];

  for (const c of defaultCities) {
    await prisma.city.upsert({
      where: { name: c.name },
      update: {},
      create: c
    });
  }
  console.log("Default cities seeded successfully.");

  console.log("Seeding complete! Database is ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
