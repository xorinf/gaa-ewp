"use strict";

// One place for the catalogue rules so the API and the UI never disagree.
const PRODUCT_TYPES = {
  grocery: {
    label: "Grocery",
    categories: [
      "Fruits & Vegetables",
      "Dairy & Eggs",
      "Bakery",
      "Meat & Seafood",
      "Beverages",
      "Snacks",
      "Staples",
      "Frozen Foods"
    ],
    units: ["kg", "g", "L", "mL", "pack", "piece", "dozen", "bunch"]
  },
  household: {
    label: "Household",
    categories: [
      "Cleaning Supplies",
      "Kitchenware",
      "Personal Care",
      "Laundry",
      "Paper Goods",
      "Home Care"
    ],
    units: ["piece", "pack", "bottle", "roll", "box", "set", "can"]
  }
};

// A product with this many units or fewer is shown as "Low Stock".
const LOW_STOCK_THRESHOLD = 5;

function stockStatus(stock) {
  if (stock <= 0) return "out-of-stock";
  if (stock <= LOW_STOCK_THRESHOLD) return "low-stock";
  return "in-stock";
}

module.exports = { PRODUCT_TYPES, LOW_STOCK_THRESHOLD, stockStatus };
