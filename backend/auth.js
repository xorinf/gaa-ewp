"use strict";

// Authentication helpers: password hashing and signed session cookies.
// Node's crypto module does everything, so there is no extra dependency.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./store");

// Kept next to the XML data so it survives restarts the same way the data does.
const SECRET_FILE = path.join(DATA_DIR, ".session-secret");
const SESSION_DAYS = 7;

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // No secret configured: keep one on disk so sessions survive restarts.
  try {
    if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
    const generated = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, generated, "utf8");
    return generated;
  } catch {
    // Read-only filesystem: fall back to a per-process secret (users log in again).
    return crypto.randomBytes(32).toString("hex");
  }
}

const SECRET = sessionSecret();

// Hashes a password with a random salt. Returns "salt:hash".
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// Checks a password against a stored "salt:hash" string.
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// Signs a payload into a token of the form base64(payload).signature
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

// Returns the payload of a valid token, or null when it is missing/tampered.
function verify(token) {
  if (!token || typeof token !== "string") return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieHeader(name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function setSessionCookie(res, user) {
  const token = sign({
    id: user.id,
    role: user.role,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  });
  res.setHeader("Set-Cookie", cookieHeader("ga_session", token, SESSION_DAYS * 24 * 60 * 60));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", cookieHeader("ga_session", "", 0));
}

// Reads the session cookie sent by the browser.
function readSessionCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "ga_session") return decodeURIComponent(rest.join("="));
  }
  return null;
}

// Middleware: attaches req.user when a valid session cookie is present.
function attachUser(req, _res, next) {
  const payload = verify(readSessionCookie(req));
  if (payload) req.user = { id: payload.id, role: payload.role };
  next();
}

// Middleware: blocks the request unless a customer is signed in.
function requireCustomer(req, res, next) {
  if (!req.user || req.user.role !== "customer") {
    return res.status(401).json({ message: "Please sign in as a customer." });
  }
  next();
}

// Middleware: blocks the request unless a shop owner is signed in.
function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== "owner") {
    return res.status(401).json({ message: "Please sign in as a shop owner." });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireCustomer,
  requireOwner
};
