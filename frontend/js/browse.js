// Browse page: shop list, product list, search and filters.

const state = {
  products: [],
  shops: [],
  categories: [],
  types: {}
};

const els = {
  search: document.getElementById("searchInput"),
  type: document.getElementById("typeFilter"),
  category: document.getElementById("categoryFilter"),
  shop: document.getElementById("shopFilter"),
  productGrid: document.getElementById("productGrid"),
  shopGrid: document.getElementById("shopGrid"),
  resultCount: document.getElementById("resultCount"),
  reset: document.getElementById("resetBtn")
};

const STATUS_LABEL = {
  "in-stock": "In stock",
  "low-stock": "Low stock",
  "out-of-stock": "Out of stock"
};

async function loadCatalog() {
  const data = await api.get("/api/catalog");
  state.types = data.types;
  state.categories = [];
  for (const type of Object.values(data.types)) {
    state.categories.push(...type.categories);
  }
  state.categories.sort();
}

async function loadShops() {
  state.shops = await api.get("/api/shops");
  els.shop.innerHTML =
    '<option value="">All shops</option>' +
    state.shops.map((shop) => `<option value="${escapeHTML(shop.id)}">${escapeHTML(shop.name)}</option>`).join("");
}

async function loadProducts() {
  const params = new URLSearchParams();
  if (els.search.value.trim()) params.set("q", els.search.value.trim());
  if (els.type.value) params.set("type", els.type.value);
  if (els.category.value) params.set("category", els.category.value);
  if (els.shop.value) params.set("shopId", els.shop.value);

  const data = await api.get(`/api/products?${params.toString()}`);
  state.products = data.products;
  renderProducts();
}

function renderShops() {
  if (!state.shops.length) {
    els.shopGrid.innerHTML = '<p class="empty">No shops have registered yet.</p>';
    return;
  }
  els.shopGrid.innerHTML = state.shops
    .map(
      (shop) => `
      <article class="shop-card">
        <h3>${escapeHTML(shop.name)}</h3>
        <p>${escapeHTML(shop.address || "No address given")}</p>
        <div class="shop-meta">
          <span>${shop.productCount} product${shop.productCount === 1 ? "" : "s"}</span>
          <span>${shop.lowStock} low stock</span>
          <span>${shop.outOfStock} out of stock</span>
        </div>
      </article>`
    )
    .join("");
}

function renderProducts() {
  if (!state.products.length) {
    els.productGrid.innerHTML = '<p class="empty">No products match these filters.</p>';
    els.resultCount.textContent = "0 products";
    return;
  }
  els.resultCount.textContent = `${state.products.length} product${state.products.length === 1 ? "" : "s"}`;

  els.productGrid.innerHTML = state.products
    .map(
      (product) => `
      <article class="product-card" data-id="${escapeHTML(product.id)}">
        <div class="product-image">
          <div class="image-fallback">${escapeHTML(product.name)}</div>
          ${
            product.imageUrl
              ? `<img src="${escapeHTML(product.imageUrl)}" alt="${escapeHTML(product.name)}" loading="lazy"
                    onerror="this.style.display='none'" />`
              : ""
          }
        </div>
        <span class="product-shop">${escapeHTML(product.shopName || "Unknown shop")}</span>
        <h3>${escapeHTML(product.name)}</h3>
        <p class="product-meta">${escapeHTML(product.category)}</p>
        <div class="product-bottom">
          <span class="price">₹${product.price.toFixed(2)} <small>/ ${escapeHTML(product.unit)}</small></span>
          <span class="stock-status ${product.status}">${STATUS_LABEL[product.status]}</span>
        </div>
        <button class="wishlist-btn" data-action="wishlist" data-id="${escapeHTML(product.id)}"
                aria-pressed="${product.wishlisted}">
          ${product.wishlisted ? "On wishlist" : "Add to wishlist"}
        </button>
      </article>`
    )
    .join("");
}

// Keeps the category dropdown in step with the selected product type.
function updateCategoryOptions() {
  const type = els.type.value;
  const list = type && state.types[type] ? state.types[type].categories : state.categories;
  els.category.innerHTML =
    '<option value="">All categories</option>' +
    list.map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join("");
  els.category.value = "";
}

async function toggleWishlist(productId, button) {
  const user = await loadUser();
  if (!user || user.role !== "customer") {
    window.location.href = "/login.html";
    return;
  }
  const isOn = button.getAttribute("aria-pressed") === "true";
  try {
    if (isOn) {
      await api.delete(`/api/wishlist/${encodeURIComponent(productId)}`);
      button.setAttribute("aria-pressed", "false");
      button.textContent = "Add to wishlist";
      showToast("Removed from your wishlist.");
    } else {
      await api.post("/api/wishlist", { productId });
      button.setAttribute("aria-pressed", "true");
      button.textContent = "On wishlist";
      showToast("Added to your wishlist.");
    }
  } catch (error) {
    showToast(error.message);
  }
}

function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

els.search.addEventListener("input", debounce(loadProducts));
els.type.addEventListener("change", () => {
  updateCategoryOptions();
  loadProducts();
});
els.category.addEventListener("change", loadProducts);
els.shop.addEventListener("change", loadProducts);
els.reset.addEventListener("click", () => {
  els.search.value = "";
  els.type.value = "";
  els.shop.value = "";
  updateCategoryOptions();
  loadProducts();
});

els.productGrid.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="wishlist"]');
  if (button) toggleWishlist(button.dataset.id, button);
});

(async function start() {
  await setupHeader();
  await loadCatalog();
  updateCategoryOptions();
  await loadShops();
  await loadProducts();
  renderShops();
})();
