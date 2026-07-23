const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Clear old tables
  await prisma.review.deleteMany().catch(() => {});
  await prisma.inquiry.deleteMany().catch(() => {});
  await prisma.message.deleteMany().catch(() => {});
  await prisma.sEOMeta.deleteMany().catch(() => {});
  await prisma.listing.deleteMany().catch(() => {});
  await prisma.store.deleteMany().catch(() => {});
  await prisma.service.deleteMany().catch(() => {});

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

  // Seed SellerProfile for seller
  await prisma.sellerProfile.upsert({
    where: { userId: seller.id },
    update: {},
    create: {
      userId: seller.id,
      fullName: "John Doe",
      displayName: "Luxe Deals Shop",
      professionalTitle: "Premium Certified Dealer",
      yearsOfExperience: 8,
      businessCategory: "Electronics, Vehicles & Lifestyle",
      aboutSeller: "We provide top-notch premium products with verified warranties. Buy with complete peace of mind.",
      email: "contact@luxedeals.com",
      mobileNumber: "9876543213",
      whatsAppNumber: "9876543213"
    }
  });

  console.log("Seller Profile seeded successfully.");

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

  const motorcycles = await prisma.subCategory.findUnique({ where: { slug: "motorcycles" } });
  const property = await prisma.category.findUnique({ where: { slug: "property" } });

  // 3. Create Sample Listings
  const listing1 = await prisma.listing.create({
    data: {
      title: "iPhone 15 Pro Max - 256GB - Titanium",
      description: "Brand new iPhone 15 Pro Max, sealed box. Local warranty available. Space Titanium color. Premium condition.",
      price: 1199,
      discountPercent: 10,
      location: "Mumbai",
      latitude: 19.0760,
      longitude: 72.8777,
      whatsappNumber: "14085551234",
      contactNumber: "14085551234",
      status: "ACTIVE",
      listingType: "SALES",
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
      location: "Delhi",
      latitude: 28.7041,
      longitude: 77.1025,
      whatsappNumber: "12135559876",
      contactNumber: "12135559876",
      status: "ACTIVE",
      listingType: "SALES",
      sellerId: seller.id,
      categoryId: vehicles.id,
      subCategoryId: cars.id,
      imagePath: "/uploads/sample-tesla.jpg"
    }
  });

  const listing3 = await prisma.listing.create({
    data: {
      title: "MacBook Pro 16 M3 Max (Used)",
      description: "Mint condition used MacBook Pro M3 Max. 36GB RAM, 1TB SSD. Space Black. Barely used, comes with original box and bill.",
      price: 2499,
      priceMax: 2699,
      discountPercent: 15,
      location: "Bangalore",
      latitude: 12.9716,
      longitude: 77.5946,
      whatsappNumber: "14155556666",
      contactNumber: "14155556666",
      status: "ACTIVE",
      listingType: "SECONDHAND",
      sellerId: seller.id,
      categoryId: electronics.id,
      subCategoryId: laptops.id,
      imagePath: "/uploads/sample-macbook.jpg"
    }
  });

  const listing4 = await prisma.listing.create({
    data: {
      title: "Royal Enfield Classic 350 - Chrome (Used)",
      description: "Chrome Red Classic 350. Well maintained, single owner, runs smoothly. Zero accidents, insurance valid till next year.",
      price: 145000,
      priceMax: 155000,
      discountPercent: 0,
      location: "Mumbai",
      latitude: 19.0760,
      longitude: 72.8777,
      whatsappNumber: "14085551234",
      contactNumber: "14085551234",
      status: "ACTIVE",
      listingType: "SECONDHAND",
      sellerId: seller.id,
      categoryId: vehicles.id,
      subCategoryId: motorcycles.id,
      imagePath: null
    }
  });

  const listing5 = await prisma.listing.create({
    data: {
      title: "Xerox, Scanning & High-Speed Color Printing",
      description: "Professional high-quality xerox, printing and book binding services at nominal rates. Discount on bulk college assignments.",
      price: 2,
      priceMax: 10,
      discountPercent: 5,
      location: "Bangalore",
      latitude: 12.9716,
      longitude: 77.5946,
      whatsappNumber: "14155556666",
      contactNumber: "14155556666",
      status: "ACTIVE",
      listingType: "SERVICES",
      sellerId: seller.id,
      categoryId: electronics.id,
      subCategoryId: null,
      imagePath: null
    }
  });

  const listing6 = await prisma.listing.create({
    data: {
      title: "Urban Salon & Spa Services at Home",
      description: "Professional salon services, haircuts, styling, and relaxing spas delivered at your doorstep by certified beauticians.",
      price: 499,
      priceMax: 1299,
      discountPercent: 10,
      location: "Delhi",
      latitude: 28.7041,
      longitude: 77.1025,
      whatsappNumber: "12135559876",
      contactNumber: "12135559876",
      status: "ACTIVE",
      listingType: "SERVICES",
      sellerId: seller.id,
      categoryId: property.id,
      subCategoryId: null,
      imagePath: null
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

  // 7. Seed Stores
  console.log("Seeding stores...");
  const storesData = [
    { name: "Gourmet Grocers", category: "Grocery", imagePath: null, location: "Bangalore", latitude: 12.9780, longitude: 77.5920, rating: 4.8, contact: "9876540001" },
    { name: "Royal Supermarket", category: "Grocery", imagePath: null, location: "Mumbai", latitude: 19.0820, longitude: 72.8820, rating: 4.5, contact: "9876540002" },
    { name: "Apollo Pharmacy & Medicals", category: "Medical", imagePath: null, location: "Bangalore", latitude: 12.9690, longitude: 77.6010, rating: 4.7, contact: "9876540003" },
    { name: "Dilli Darbar Restaurant", category: "Restaurants", imagePath: null, location: "Delhi", latitude: 28.7110, longitude: 77.1120, rating: 4.6, contact: "9876540004" },
    { name: "Trendy Threads Clothing", category: "Clothing", imagePath: null, location: "Bangalore", latitude: 12.9620, longitude: 77.5850, rating: 4.2, contact: "9876540005" },
    { name: "Mega Electronics Hub", category: "Electronics", imagePath: null, location: "Bangalore", latitude: 12.9800, longitude: 77.6100, rating: 4.9, contact: "9876540006" },
    { name: "Woodland Furniture World", category: "Furniture", imagePath: null, location: "Hyderabad", latitude: 17.3910, longitude: 78.4910, rating: 4.4, contact: "9876540007" },
    { name: "Metro Hardware & Tools", category: "Hardware", imagePath: null, location: "Bangalore", latitude: 12.9750, longitude: 77.5950, rating: 4.3, contact: "9876540008" },
    { name: "Paper & Pen Stationery", category: "Stationery", imagePath: null, location: "Pune", latitude: 18.5250, longitude: 73.8620, rating: 4.1, contact: "9876540009" },
    { name: "Glittering Gold Jewellery", category: "Jewellery", imagePath: null, location: "Jaipur", latitude: 26.9200, longitude: 75.7950, rating: 4.7, contact: "9876540010" },
    { name: "Bake & Cake Bakery", category: "Bakery", imagePath: null, location: "Bangalore", latitude: 12.9700, longitude: 77.5900, rating: 4.6, contact: "9876540011" },
    { name: "Grand Plaza Hotel", category: "Hotels", imagePath: null, location: "Mumbai", latitude: 19.0700, longitude: 72.8700, rating: 4.8, contact: "9876540012" }
  ];

  for (const store of storesData) {
    await prisma.store.create({ data: store });
  }
  console.log("Stores seeded.");

  // 8. Seed Services
  console.log("Seeding services...");
  const servicesData = [
    { name: "QuickFix Electricians", serviceType: "Electrician", icon: "⚡", location: "Bangalore", latitude: 12.9730, longitude: 77.5910, rating: 4.7, contact: "9876540101" },
    { name: "FlowRight Plumbers", serviceType: "Plumber", icon: "🔧", location: "Bangalore", latitude: 12.9680, longitude: 77.5980, rating: 4.5, contact: "9876540102" },
    { name: "Sparkle Cleaners", serviceType: "Home Cleaning", icon: "🧹", location: "Bangalore", latitude: 12.9750, longitude: 77.5890, rating: 4.8, contact: "9876540103" },
    { name: "CoolBreeze AC Service", serviceType: "AC Repair", icon: "❄️", location: "Mumbai", latitude: 19.0790, longitude: 72.8720, rating: 4.6, contact: "9876540104" },
    { name: "Express Car Garage", serviceType: "Car Repair", icon: "🚗", location: "Bangalore", latitude: 12.9820, longitude: 77.6020, rating: 4.9, contact: "9876540105" },
    { name: "Swift Movers & Packers", serviceType: "Packers & Movers", icon: "📦", location: "Delhi", latitude: 28.7010, longitude: 77.1080, rating: 4.4, contact: "9876540106" },
    { name: "Precision Painters", serviceType: "Painter", icon: "🎨", location: "Bangalore", latitude: 12.9650, longitude: 77.5930, rating: 4.3, contact: "9876540107" },
    { name: "PureWater RO Solutions", serviceType: "RO Service", icon: "💧", location: "Hyderabad", latitude: 17.3890, longitude: 78.4810, rating: 4.5, contact: "9876540108" }
  ];

  for (const service of servicesData) {
    await prisma.service.create({ data: service });
  }
  console.log("Services seeded.");

  // 9. Seed Store & Service Reviews
  console.log("Seeding store & service reviews...");
  const dbStores = await prisma.store.findMany();
  const dbServices = await prisma.service.findMany();

  if (dbStores.length > 0) {
    await prisma.review.create({
      data: {
        storeId: dbStores[0].id,
        buyerId: buyer.id,
        rating: 5,
        comment: "Excellent grocery selection! Extremely fresh vegetables and quick delivery options."
      }
    });
    await prisma.review.create({
      data: {
        storeId: dbStores[0].id,
        buyerId: seo.id,
        rating: 4,
        comment: "Very neat store layout. Found organic items that are usually out of stock elsewhere."
      }
    });
  }

  if (dbServices.length > 0) {
    await prisma.review.create({
      data: {
        serviceId: dbServices[0].id,
        buyerId: buyer.id,
        rating: 5,
        comment: "Prompt response and quick troubleshooting! Solved my living room wiring issue in 15 minutes."
      }
    });
  }
  console.log("Store & service reviews seeded.");

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
