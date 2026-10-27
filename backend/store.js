"use strict";

// Reads and writes the four XML files that hold the whole application state.
// Every write is checked against its DTD first, so a malformed file can never
// reach the disk.

const fs = require("fs");
const path = require("path");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");
const { Libxml } = require("node-libxml");

const DATA_DIR = resolveDataDir();
const DTD_DIR = path.join(__dirname, "dtd");

// Uses DATA_DIR when it is set and writable. Without a persistent disk (for
// example on Render's free plan) that path cannot be created, so fall back to
// a folder inside the project and say so.
function resolveDataDir() {
  const configured = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, "data");
  try {
    fs.mkdirSync(configured, { recursive: true });
    fs.accessSync(configured, fs.constants.W_OK);
    return configured;
  } catch (error) {
    if (!process.env.DATA_DIR) throw error;
    const fallback = path.join(__dirname, "data");
    fs.mkdirSync(fallback, { recursive: true });
    console.warn(
      `DATA_DIR (${configured}) is not writable (${error.code}). Using ${fallback} instead. ` +
        "Data will not survive a redeploy until a persistent disk is attached."
    );
    return fallback;
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  indentBy: "  ",
  suppressEmptyNode: false
});

// Each collection knows its file, its DTD and its root/item element names.
const COLLECTIONS = {
  users: { file: "users.xml", dtd: "users.dtd", root: "users", item: "user" },
  shops: { file: "shops.xml", dtd: "shops.dtd", root: "shops", item: "shop" },
  products: { file: "products.xml", dtd: "products.dtd", root: "products", item: "product" },
  wishlists: { file: "wishlists.xml", dtd: "wishlists.dtd", root: "wishlists", item: "wishlist" }
};

function fileFor(name) {
  return path.join(DATA_DIR, COLLECTIONS[name].file);
}

function dtdFor(name) {
  return path.join(DATA_DIR, COLLECTIONS[name].dtd);
}

// Returns the parsed rows of a collection as an array of plain objects.
function read(name) {
  const spec = COLLECTIONS[name];
  if (!fs.existsSync(fileFor(name))) return [];
  const xml = fs.readFileSync(fileFor(name), "utf8");
  const parsed = parser.parse(xml);
  const root = parsed[spec.root] || {};
  const rows = root[spec.item];
  if (!rows) return [];
  return (Array.isArray(rows) ? rows : [rows]).map(normalise);
}

// fast-xml-parser puts attributes under "@_" and text under "#text".
// Strip both so the rest of the app only sees plain key/value pairs.
function normalise(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === ":@" || key === "#text") continue;
    out[key] = typeof value === "object" && value !== null ? (value["#text"] ?? "") : value;
  }
  return out;
}

// Builds the XML text for a collection.
function build(name, rows) {
  const spec = COLLECTIONS[name];
  const body = {};
  body[spec.root] = {};
  if (rows.length > 0) body[spec.root][spec.item] = rows;
  const xml = builder.build(body);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE ${spec.root} SYSTEM "${spec.dtd}">\n${xml}\n`;
}

// Validates XML text against a DTD. Throws with a readable message on failure.
function validate(name, xml) {
  const libxml = new Libxml();
  const wellFormed = libxml.loadXmlFromString(xml);
  if (!wellFormed) {
    const messages = (libxml.wellformedErrors || []).map((e) => e.message);
    libxml.clearAll();
    throw new Error(`${name}.xml is not well-formed XML: ${messages.join("; ")}`);
  }
  libxml.loadDtds([dtdFor(name)]);
  const valid = libxml.validateAgainstDtds();
  if (!valid) {
    const errors = libxml.validationDtdErrors || {};
    const messages = Object.values(errors)
      .flat()
      .map((e) => e.message);
    libxml.clearAll();
    throw new Error(`${name}.xml does not match its DTD: ${messages.join("; ")}`);
  }
  libxml.clearAll();
  return true;
}

// Writes a collection to disk after validating it.
function write(name, rows) {
  const xml = build(name, rows);
  validate(name, xml);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fileFor(name), xml, "utf8");
  return rows;
}

// Creates the data directory on first run: copies the DTDs next to the XML
// files (so each file can be opened with any standard XML tool) and writes
// an empty, valid file for every collection.
function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const name of Object.keys(COLLECTIONS)) {
    fs.copyFileSync(path.join(DTD_DIR, COLLECTIONS[name].dtd), dtdFor(name));
  }
  for (const name of Object.keys(COLLECTIONS)) {
    if (!fs.existsSync(fileFor(name))) write(name, []);
  }
}

// Simple incrementing id: p1, p2, ... based on what is already stored.
function nextId(name, prefix) {
  const rows = read(name);
  const highest = rows.reduce((max, row) => {
    const n = parseInt(String(row.id).replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${highest + 1}`;
}

module.exports = { read, write, build, validate, init, nextId, DATA_DIR, COLLECTIONS };
