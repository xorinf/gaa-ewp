"use strict";

// Grocery Availability - Express API + static frontend.

const express = require("express");
const path = require("path");
const store = require("./store");
const auth = require("./auth");
const { PRODUCT_TYPES, LOW_STOCK_THRESHOLD, stockStatus } = require("./catalog");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(auth.attachUser);
app.use(express.static(path.join(__dirname, "..", "frontend")));

const clean = (value) => (typeof value === "string" ? value.trim() : "");
const now = () => new Date().toISOString();

// Only http(s) URLs are accepted, so the browser never loads javascript: or
// data: URLs from the database.
function cleanImageUrl(value) {
  const url = clean(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    // Not a valid URL.
  }
  return "";
}

// Turns a stored product row into the JSON the browser receives.
function publicProduct(row, shopName) {
  const stock = Number(row.stock) || 0;
  const price = Number(row.price) || 0;
  return {
    id: row.id,
    shopId: row.shopId,
    shopName: shopName || "",
    name: row.name,
    type: row.type,
    category: row.category,
    unit: row.unit,
    price,
    stock,
    status: stockStatus(stock),
    imageUrl: row.imageUrl || "",
    updatedAt: row.updatedAt
  };
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, shopId: row.shopId || null };
}

function shopNameById(shopId) {
  const shop = store.read("shops").find((s) => s.id === shopId);
  return shop ? shop.name : "";
}

// Counts how many distinct customers wishlisted each product of a shop.
function wishlistCounts(shopId) {
  const counts = {};
  const productIds = new Set(
    store.read("products").filter((p) => p.shopId === shopId).map((p) => p.id)
  );
  const wishers = {};
  for (const entry of store.read("wishlists")) {
    if (!productIds.has(entry.productId)) continue;
    if (!wishers[entry.productId]) wishers[entry.productId] = new Set();
    wishers[entry.productId].add(entry.userId);
  }
  for (const [productId, users] of Object.entries(wishers)) {
    counts[productId] = users.size;
  }
  return counts;
}

// ---------------------------------------------------------------- catalogue
app.get("/api/catalog", (_req, res) => {
  res.json({ types: PRODUCT_TYPES, lowStockThreshold: LOW_STOCK_THRESHOLD });
});

// -------------------------------------------------------------------- auth
app.post("/api/auth/register", (req, res) => {
  const name = clean(req.body?.name);
  const email = clean(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = clean(req.body?.role);

  if (!name || name.length > 80) return res.status(400).json({ message: "Enter your name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
  if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters." });
  if (role !== "customer" && role !== "owner") return res.status(400).json({ message: "Choose either customer or shop owner." });

  const users = store.read("users");
  if (users.some((u) => u.email.toLowerCase() === email)) {
    return res.status(409).json({ message: "An account with that email already exists." });
  }

  const shopName = clean(req.body?.shopName);
  const shopAddress = clean(req.body?.shopAddress);
  if (role === "owner" && !shopName) {
    return res.status(400).json({ message: "Enter your shop name." });
  }

  const user = {
    id: store.nextId("users", "u"),
    name,
    email,
    role,
    passwordHash: auth.hashPassword(password),
    createdAt: now(),
    shopId: ""
  };

  if (role === "owner") {
    const shops = store.read("shops");
    const shop = {
      id: store.nextId("shops", "s"),
      ownerId: user.id,
      name: shopName,
      address: shopAddress,
      phone: clean(req.body?.shopPhone),
      createdAt: now()
    };
    user.shopId = shop.id;
    shops.push(shop);
    store.write("shops", shops);
  }

  users.push(user);
  store.write("users", users);

  auth.setSessionCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const email = clean(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = store.read("users").find((u) => u.email.toLowerCase() === email);
  if (!user || !auth.verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ message: "Email or password is incorrect." });
  }
  auth.setSessionCookie(res, user);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (_req, res) => {
  auth.clearSessionCookie(res);
  res.json({ message: "Signed out." });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Not signed in." });
  const user = store.read("users").find((u) => u.id === req.user.id);
  if (!user) return res.status(401).json({ message: "Not signed in." });
  res.json({ user: publicUser(user) });
});

// ------------------------------------------------------------------- shops
app.get("/api/shops", (_req, res) => {
  const shops = store.read("shops");
  const products = store.read("products");
  res.json(
    shops.map((shop) => {
      const own = products.filter((p) => p.shopId === shop.id);
      const lowStock = own.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= LOW_STOCK_THRESHOLD).length;
      const outOfStock = own.filter((p) => Number(p.stock) <= 0).length;
      return {
        id: shop.id,
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        productCount: own.length,
        lowStock,
        outOfStock
      };
    })
  );
});

// ---------------------------------------------------------------- products
app.get("/api/products", (req, res) => {
  const query = clean(req.query.q).toLowerCase();
  const category = clean(req.query.category);
  const type = clean(req.query.type);
  const shopId = clean(req.query.shopId);

  const wishlisted = new Set(
    req.user && req.user.role === "customer"
      ? store.read("wishlists").filter((w) => w.userId === req.user.id).map((w) => w.productId)
      : []
  );

  const products = store
    .read("products")
    .filter((product) => {
      if (query && !`${product.name} ${product.category}`.toLowerCase().includes(query)) return false;
      if (category && product.category !== category) return false;
      if (type && product.type !== type) return false;
      if (shopId && product.shopId !== shopId) return false;
      return true;
    })
    .map((row) => ({
      ...publicProduct(row, shopNameById(row.shopId)),
      wishlisted: wishlisted.has(row.id)
    }));

  res.json({ products });
});

// One product with its wishlist count (used by the owner dashboard).
app.get("/api/products/:id", (req, res) => {
  const row = store.read("products").find((p) => p.id === req.params.id);
  if (!row) return res.status(404).json({ message: "Product not found." });
  const counts = wishlistCounts(row.shopId);
  res.json({ product: { ...publicProduct(row, shopNameById(row.shopId)), wishlistCount: counts[row.id] || 0 } });
});

// ---------------------------------------------------------------- wishlists
app.get("/api/wishlist", auth.requireCustomer, (req, res) => {
  const entries = store.read("wishlists").filter((w) => w.userId === req.user.id);
  const products = store.read("products");
  const shops = store.read("shops");
  res.json({
    items: entries.map((entry) => {
      const product = products.find((p) => p.id === entry.productId);
      if (!product) return null;
      const shop = shops.find((s) => s.id === product.shopId);
      return { ...publicProduct(product, shop ? shop.name : ""), addedAt: entry.createdAt };
    }).filter(Boolean)
  });
});

app.post("/api/wishlist", auth.requireCustomer, (req, res) => {
  const productId = clean(req.body?.productId);
  const product = store.read("products").find((p) => p.id === productId);
  if (!product) return res.status(404).json({ message: "Product not found." });

  const wishlists = store.read("wishlists");
  const already = wishlists.some((w) => w.userId === req.user.id && w.productId === productId);
  if (already) return res.status(409).json({ message: "That product is already on your wishlist." });

  wishlists.push({
    id: store.nextId("wishlists", "w"),
    userId: req.user.id,
    productId,
    createdAt: now()
  });
  store.write("wishlists", wishlists);
  res.status(201).json({ message: "Added to your wishlist." });
});

app.delete("/api/wishlist/:productId", auth.requireCustomer, (req, res) => {
  const wishlists = store.read("wishlists");
  const remaining = wishlists.filter(
    (w) => !(w.userId === req.user.id && w.productId === req.params.productId)
  );
  if (remaining.length === wishlists.length) {
    return res.status(404).json({ message: "That product is not on your wishlist." });
  }
  store.write("wishlists", remaining);
  res.json({ message: "Removed from your wishlist." });
});

// ------------------------------------------------------------ owner / shop
// The signed-in owner's shop.
app.get("/api/owner/shop", auth.requireOwner, (req, res) => {
  const user = store.read("users").find((u) => u.id === req.user.id);
  const shop = store.read("shops").find((s) => s.id === user?.shopId);
  if (!shop) return res.status(404).json({ message: "No shop is linked to this account." });
  res.json({ shop });
});

// The owner's inventory with a wishlist count per product.
app.get("/api/owner/products", auth.requireOwner, (req, res) => {
  const user = store.read("users").find((u) => u.id === req.user.id);
  const counts = wishlistCounts(user?.shopId);
  const products = store
    .read("products")
    .filter((p) => p.shopId === user?.shopId)
    .map((row) => ({
      ...publicProduct(row),
      wishlistCount: counts[row.id] || 0
    }));
  res.json({ products });
});

// Adds a product to the owner's shop.
app.post("/api/owner/products", auth.requireOwner, (req, res) => {
  const user = store.read("users").find((u) => u.id === req.user.id);
  if (!user?.shopId) return res.status(404).json({ message: "No shop is linked to this account." });

  const name = clean(req.body?.name);
  const type = clean(req.body?.type);
  const category = clean(req.body?.category);
  const unit = clean(req.body?.unit);
  const price = Number(req.body?.price);
  const stock = Number(req.body?.stock);
  const imageUrl = cleanImageUrl(req.body?.imageUrl);

  if (!name) return res.status(400).json({ message: "Enter the product name." });
  if (!PRODUCT_TYPES[type]) return res.status(400).json({ message: "Choose Grocery or Household." });
  if (!PRODUCT_TYPES[type].categories.includes(category)) {
    return res.status(400).json({ message: "Choose a category that belongs to that product type." });
  }
  if (!PRODUCT_TYPES[type].units.includes(unit)) {
    return res.status(400).json({ message: "Choose a unit that belongs to that product type." });
  }
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ message: "Enter a price greater than zero." });
  if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ message: "Enter stock as a whole number of zero or more." });
  if (clean(req.body?.imageUrl) && !imageUrl) {
    return res.status(400).json({ message: "Image URL must start with http:// or https://" });
  }

  const products = store.read("products");
  const product = {
    id: store.nextId("products", "p"),
    shopId: user.shopId,
    name,
    type,
    category,
    unit,
    price: price.toFixed(2),
    stock: String(stock),
    createdAt: now(),
    updatedAt: now(),
    imageUrl
  };
  products.push(product);
  store.write("products", products);
  res.status(201).json({ product: publicProduct(product) });
});

// Updates price and/or stock of one of the owner's products.
app.patch("/api/owner/products/:id", auth.requireOwner, (req, res) => {
  const user = store.read("users").find((u) => u.id === req.user.id);
  const products = store.read("products");
  const product = products.find((p) => p.id === req.params.id && p.shopId === user?.shopId);
  if (!product) return res.status(404).json({ message: "Product not found in your shop." });

  const hasPrice = req.body?.price !== undefined;
  const hasStock = req.body?.stock !== undefined;
  const hasImage = req.body?.imageUrl !== undefined;
  const price = Number(req.body?.price);
  const stock = Number(req.body?.stock);
  const imageUrl = cleanImageUrl(req.body?.imageUrl);

  if (hasPrice && (!Number.isFinite(price) || price <= 0)) {
    return res.status(400).json({ message: "Enter a price greater than zero." });
  }
  if (hasStock && (!Number.isInteger(stock) || stock < 0)) {
    return res.status(400).json({ message: "Enter stock as a whole number of zero or more." });
  }
  if (hasImage && clean(req.body?.imageUrl) && !imageUrl) {
    return res.status(400).json({ message: "Image URL must start with http:// or https://" });
  }

  if (hasPrice) product.price = price.toFixed(2);
  if (hasStock) product.stock = String(stock);
  if (hasImage) product.imageUrl = imageUrl;
  product.updatedAt = now();

  store.write("products", products);
  res.json({ product: publicProduct(product) });
});

// Removes a product from the owner's shop, and any wishlist entries for it.
app.delete("/api/owner/products/:id", auth.requireOwner, (req, res) => {
  const user = store.read("users").find((u) => u.id === req.user.id);
  const products = store.read("products");
  const remaining = products.filter((p) => !(p.id === req.params.id && p.shopId === user?.shopId));
  if (remaining.length === products.length) {
    return res.status(404).json({ message: "Product not found in your shop." });
  }
  store.write("products", remaining);
  store.write(
    "wishlists",
    store.read("wishlists").filter((w) => w.productId !== req.params.id)
  );
  res.json({ message: "Product removed." });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Unknown API routes get JSON, everything else falls back to the frontend.
app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found." }));

if (require.main === module) {
  store.init();
  // A fresh deployment (empty persistent disk) gets the demo data so the
  // site is not blank on first load.
  require("./seed").main();
  app.listen(PORT, () => console.log(`Grocery Availability running at http://localhost:${PORT}`));
}

module.exports = app;
