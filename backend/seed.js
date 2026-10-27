"use strict";

// Fills an empty data directory with demo shops, products and accounts.
// Run once with: npm run seed
// The server also calls this on start-up so a fresh deployment has data.

const store = require("./store");
const auth = require("./auth");

const DEMO_PASSWORD = "demo1234";

const SHOPS = [
  { name: "GreenLeaf Market", address: "12 MG Road, Bengaluru", phone: "9845012345" },
  { name: "Daily Needs Store", address: "4 Park Street, Kolkata", phone: "9830023456" }
];

// Each row: shop, type, category, name, unit, price, stock, image url.
// The picsum.photos seed gives every product a stable, different picture.
const PRODUCTS = [
  ["GreenLeaf Market", "grocery", "Fruits & Vegetables", "Bananas", "kg", "42.00", 30, "https://picsum.photos/seed/banana/600/400"],
  ["GreenLeaf Market", "grocery", "Fruits & Vegetables", "Tomatoes", "kg", "36.50", 4, "https://picsum.photos/seed/tomato/600/400"],
  ["GreenLeaf Market", "grocery", "Dairy & Eggs", "Farm Eggs", "dozen", "84.00", 12, "https://picsum.photos/seed/eggs/600/400"],
  ["GreenLeaf Market", "grocery", "Dairy & Eggs", "Milk", "L", "54.00", 0, "https://picsum.photos/seed/milk/600/400"],
  ["GreenLeaf Market", "grocery", "Staples", "Basmati Rice", "kg", "128.00", 8, "https://picsum.photos/seed/rice/600/400"],
  ["GreenLeaf Market", "grocery", "Beverages", "Orange Juice", "L", "96.00", 5, "https://picsum.photos/seed/juice/600/400"],
  ["GreenLeaf Market", "household", "Cleaning Supplies", "Dish Wash Liquid", "bottle", "72.00", 15, "https://picsum.photos/seed/dishwash/600/400"],
  ["GreenLeaf Market", "household", "Personal Care", "Bath Soap", "pack", "118.00", 2, "https://picsum.photos/seed/soap/600/400"],
  ["Daily Needs Store", "grocery", "Bakery", "Whole Wheat Bread", "piece", "42.00", 20, "https://picsum.photos/seed/bread/600/400"],
  ["Daily Needs Store", "grocery", "Snacks", "Salted Biscuits", "pack", "35.00", 40, "https://picsum.photos/seed/biscuits/600/400"],
  ["Daily Needs Store", "grocery", "Frozen Foods", "Green Peas", "pack", "88.00", 6, "https://picsum.photos/seed/peas/600/400"],
  ["Daily Needs Store", "household", "Laundry", "Detergent Powder", "kg", "164.00", 9, "https://picsum.photos/seed/detergent/600/400"],
  ["Daily Needs Store", "household", "Paper Goods", "Kitchen Towels", "roll", "48.00", 18, "https://picsum.photos/seed/towels/600/400"],
  ["Daily Needs Store", "household", "Kitchenware", "Steel Cookware Set", "set", "1249.00", 3, "https://picsum.photos/seed/cookware/600/400"]
];

function main() {
  store.init();

  if (store.read("shops").length > 0) {
    console.log("Data directory already has shops. Nothing to seed.");
    return false;
  }

  const now = new Date().toISOString();
  const users = store.read("users");
  const shops = store.read("shops");
  const products = store.read("products");

  // Two shop owners, one customer.
  const ownerUsers = SHOPS.map((shop, index) => ({
    id: `u${index + 1}`,
    name: `${shop.name} Owner`,
    email: `owner${index + 1}@example.com`,
    role: "owner",
    passwordHash: auth.hashPassword(DEMO_PASSWORD),
    createdAt: now,
    shopId: `s${index + 1}`
  }));
  users.push(...ownerUsers);

  SHOPS.forEach((shop, index) => {
    shops.push({
      id: `s${index + 1}`,
      ownerId: `u${index + 1}`,
      name: shop.name,
      address: shop.address,
      phone: shop.phone,
      createdAt: now
    });
  });

  users.push({
    id: "u3",
    name: "Demo Customer",
    email: "customer@example.com",
    role: "customer",
    passwordHash: auth.hashPassword(DEMO_PASSWORD),
    createdAt: now,
    shopId: ""
  });

  const shopIdByName = {};
  shops.forEach((shop) => {
    shopIdByName[shop.name] = shop.id;
  });

  PRODUCTS.forEach(([shopName, type, category, name, unit, price, stock, imageUrl], index) => {
    products.push({
      id: `p${index + 1}`,
      shopId: shopIdByName[shopName],
      name,
      type,
      category,
      unit,
      price,
      stock: String(stock),
      createdAt: now,
      updatedAt: now,
      imageUrl
    });
  });

  store.write("users", users);
  store.write("shops", shops);
  store.write("products", products);

  console.log(`Seeded ${shops.length} shops, ${products.length} products and ${users.length} users.`);
  console.log(`Demo password for every demo account: ${DEMO_PASSWORD}`);
  return true;
}

module.exports = { main, DEMO_PASSWORD };

// Run directly with "npm run seed". When the server requires this file it
// calls main() itself.
if (require.main === module) main();
