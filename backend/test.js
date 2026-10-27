"use strict";

// End-to-end tests for the API. Run with: npm test
// The tests use a throwaway data directory, so they never touch real data.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gaa-test-"));
process.env.DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = "test-secret";

const store = require("./store");
const app = require("./server");

let server;
let baseUrl;

test.before(async () => {
  store.init();
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// Small helper: call the API and keep the session cookie between calls.
function client() {
  let cookie = "";
  return async function call(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  };
}

test("every XML file validates against its DTD", () => {
  for (const name of Object.keys(store.COLLECTIONS)) {
    const xml = fs.readFileSync(path.join(DATA_DIR, store.COLLECTIONS[name].file), "utf8");
    assert.doesNotThrow(() => store.validate(name, xml), `${name}.xml should be valid`);
  }
});

test("a malformed row is rejected before it reaches disk", () => {
  // The users DTD does not allow a "nickname" element.
  const bad = [{ id: "u1", name: "A", email: "a@b.c", role: "customer", passwordHash: "x", createdAt: "now", nickname: "nope" }];
  assert.throws(() => store.build("users", bad) && store.validate("users", store.build("users", bad)));
});

test("stock status is derived from the stock count", () => {
  const { stockStatus } = require("./catalog");
  assert.equal(stockStatus(0), "out-of-stock");
  assert.equal(stockStatus(-2), "out-of-stock");
  assert.equal(stockStatus(1), "low-stock");
  assert.equal(stockStatus(5), "low-stock");
  assert.equal(stockStatus(6), "in-stock");
});

test("customer registration signs the customer in", async () => {
  const call = client();
  const result = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Asha", email: "asha@example.com", password: "secret123", role: "customer" })
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.user.role, "customer");

  const me = await call("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "asha@example.com");
});

test("duplicate email is rejected", async () => {
  const call = client();
  const result = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Other", email: "asha@example.com", password: "secret123", role: "customer" })
  });
  assert.equal(result.status, 409);
});

test("short password is rejected", async () => {
  const call = client();
  const result = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Short", email: "short@example.com", password: "123", role: "customer" })
  });
  assert.equal(result.status, 400);
});

test("wrong password does not sign in", async () => {
  const call = client();
  const result = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "asha@example.com", password: "wrong-password" })
  });
  assert.equal(result.status, 401);
});

test("owner registration creates a shop", async () => {
  const call = client();
  const result = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Ravi",
      email: "ravi@example.com",
      password: "secret123",
      role: "owner",
      shopName: "Ravi Fresh",
      shopAddress: "5 Lane"
    })
  });
  assert.equal(result.status, 201);
  assert.ok(result.body.user.shopId, "owner should be linked to a shop");

  const shop = await call("/api/owner/shop");
  assert.equal(shop.status, 200);
  assert.equal(shop.body.shop.name, "Ravi Fresh");
});

test("a customer cannot reach owner-only routes", async () => {
  const call = client();
  await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "asha@example.com", password: "secret123" })
  });
  const result = await call("/api/owner/products");
  assert.equal(result.status, 401);
});

test("an owner cannot touch another shop's product", async () => {
  const ravi = client();
  await ravi("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ravi@example.com", password: "secret123" })
  });
  const created = await ravi("/api/owner/products", {
    method: "POST",
    body: JSON.stringify({ name: "Coffee", type: "grocery", category: "Beverages", unit: "pack", price: "250", stock: 7 })
  });
  assert.equal(created.status, 201);

  const other = client();
  await other("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Other Owner", email: "other@example.com", password: "secret123", role: "owner", shopName: "Other Shop" })
  });
  const stolen = await other(`/api/owner/products/${created.body.product.id}`, {
    method: "PATCH",
    body: JSON.stringify({ price: "1" })
  });
  assert.equal(stolen.status, 404);
});

test("product validation rejects bad category, unit, price and stock", async () => {
  const call = client();
  await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ravi@example.com", password: "secret123" })
  });
  const bad = [
    { name: "X", type: "grocery", category: "Laundry", unit: "pack", price: "10", stock: 1 },
    { name: "X", type: "grocery", category: "Beverages", unit: "bottle", price: "10", stock: 1 },
    { name: "X", type: "grocery", category: "Beverages", unit: "pack", price: "-5", stock: 1 },
    { name: "X", type: "grocery", category: "Beverages", unit: "pack", price: "10", stock: -3 },
    { name: "X", type: "grocery", category: "Beverages", unit: "pack", price: "10", stock: 1.5 },
    { name: "X", type: "grocery", category: "Beverages", unit: "pack", price: "10", stock: 1, imageUrl: "javascript:alert(1)" }
  ];
  for (const body of bad) {
    const result = await call("/api/owner/products", { method: "POST", body: JSON.stringify(body) });
    assert.equal(result.status, 400, `should reject ${JSON.stringify(body)}`);
  }
});

test("customer can wishlist a product and the owner sees the count", async () => {
  const owner = client();
  await owner("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ravi@example.com", password: "secret123" })
  });
  const created = await owner("/api/owner/products", {
    method: "POST",
    body: JSON.stringify({ name: "Tea", type: "grocery", category: "Beverages", unit: "pack", price: "120", stock: 9 })
  });
  const productId = created.body.product.id;

  const customer = client();
  await customer("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "asha@example.com", password: "secret123" })
  });
  const added = await customer("/api/wishlist", { method: "POST", body: JSON.stringify({ productId }) });
  assert.equal(added.status, 201);

  // The same product cannot be added twice.
  const again = await customer("/api/wishlist", { method: "POST", body: JSON.stringify({ productId }) });
  assert.equal(again.status, 409);

  const wishlist = await customer("/api/wishlist");
  assert.equal(wishlist.body.items.length, 1);
  assert.equal(wishlist.body.items[0].id, productId);

  const inventory = await owner("/api/owner/products");
  const row = inventory.body.products.find((p) => p.id === productId);
  assert.equal(row.wishlistCount, 1);

  // A second customer wishing the same product makes it 2.
  const customer2 = client();
  await customer2("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Second", email: "second@example.com", password: "secret123", role: "customer" })
  });
  await customer2("/api/wishlist", { method: "POST", body: JSON.stringify({ productId }) });

  const inventory2 = await owner("/api/owner/products");
  const row2 = inventory2.body.products.find((p) => p.id === productId);
  assert.equal(row2.wishlistCount, 2, "two distinct customers wishlisted it");

  // Removing it drops the count back.
  await customer("/api/wishlist/" + productId, { method: "DELETE" });
  const inventory3 = await owner("/api/owner/products");
  assert.equal(inventory3.body.products.find((p) => p.id === productId).wishlistCount, 1);
});

test("price and stock can be updated, and the status follows", async () => {
  const call = client();
  await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ravi@example.com", password: "secret123" })
  });
  const created = await call("/api/owner/products", {
    method: "POST",
    body: JSON.stringify({ name: "Soap", type: "household", category: "Personal Care", unit: "pack", price: "80", stock: 20 })
  });
  const id = created.body.product.id;
  assert.equal(created.body.product.status, "in-stock");

  const low = await call(`/api/owner/products/${id}`, { method: "PATCH", body: JSON.stringify({ stock: 3 }) });
  assert.equal(low.body.product.status, "low-stock");

  const out = await call(`/api/owner/products/${id}`, { method: "PATCH", body: JSON.stringify({ stock: 0 }) });
  assert.equal(out.body.product.status, "out-of-stock");

  const priced = await call(`/api/owner/products/${id}`, { method: "PATCH", body: JSON.stringify({ price: "95.5" }) });
  assert.equal(priced.body.product.price, 95.5);
  assert.equal(priced.body.product.stock, 0, "stock should be unchanged");
});

test("search and filters narrow the product list", async () => {
  const call = client();
  const all = await call("/api/products");
  const total = all.body.products.length;
  assert.ok(total > 0);

  const grocery = await call("/api/products?type=grocery");
  assert.ok(grocery.body.products.every((p) => p.type === "grocery"));

  const search = await call("/api/products?q=soap");
  assert.ok(search.body.products.length > 0);
  assert.ok(search.body.products.every((p) => p.name.toLowerCase().includes("soap")));

  const category = await call("/api/products?type=grocery&category=Beverages");
  assert.ok(category.body.products.every((p) => p.category === "Beverages" && p.type === "grocery"));

  const empty = await call("/api/products?q=zzzznotathing");
  assert.equal(empty.body.products.length, 0);
});

test("deleting a product also clears its wishlist entries", async () => {
  const owner = client();
  await owner("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ravi@example.com", password: "secret123" })
  });
  const created = await owner("/api/owner/products", {
    method: "POST",
    body: JSON.stringify({ name: "Mango", type: "grocery", category: "Fruits & Vegetables", unit: "kg", price: "90", stock: 4 })
  });
  const productId = created.body.product.id;

  const customer = client();
  await customer("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "asha@example.com", password: "secret123" })
  });
  await customer("/api/wishlist", { method: "POST", body: JSON.stringify({ productId }) });

  const removed = await owner(`/api/owner/products/${productId}`, { method: "DELETE" });
  assert.equal(removed.status, 200);

  const wishlist = await customer("/api/wishlist");
  assert.equal(wishlist.body.items.length, 0);
});

test("the wishlist count is only shown to the owner of that product's shop", async () => {
  const owner = client();
  await owner("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ravi@example.com", password: "secret123" })
  });
  const created = await owner("/api/owner/products", {
    method: "POST",
    body: JSON.stringify({ name: "Privacy", type: "grocery", category: "Snacks", unit: "pack", price: "50", stock: 5 })
  });
  const productId = created.body.product.id;

  const customer = client();
  await customer("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "asha@example.com", password: "secret123" })
  });
  await customer("/api/wishlist", { method: "POST", body: JSON.stringify({ productId }) });

  // The owner of the shop sees the count.
  const asOwner = await owner(`/api/products/${productId}`);
  assert.equal(asOwner.body.product.wishlistCount, 1);

  // A customer must not see anyone else's count.
  const asCustomer = await customer(`/api/products/${productId}`);
  assert.equal(asCustomer.body.product.wishlistCount, undefined);

  // A signed-out visitor must not see it either.
  const anonymous = await client()(`/api/products/${productId}`);
  assert.equal(anonymous.body.product.wishlistCount, undefined);

  // A different owner must not see another shop's count.
  const otherOwner = client();
  await otherOwner("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "other@example.com", password: "secret123" })
  });
  const asOtherOwner = await otherOwner(`/api/products/${productId}`);
  assert.equal(asOtherOwner.body.product.wishlistCount, undefined);
});

test("signing out clears the session", async () => {
  const call = client();
  await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "asha@example.com", password: "secret123" })
  });
  await call("/api/auth/logout", { method: "POST" });
  const me = await call("/api/auth/me");
  assert.equal(me.status, 401);
});

test("data survives a fresh read from disk", () => {
  const users = store.read("users");
  assert.ok(users.length >= 4);
  assert.ok(users.some((u) => u.email === "asha@example.com"));
  assert.ok(users.every((u) => u.passwordHash.includes(":")));
});
