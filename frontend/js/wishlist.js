// Customer wishlist page.

const els = {
  list: document.getElementById("wishlistList"),
  summary: document.getElementById("wishlistSummary")
};

const STATUS_LABEL = {
  "in-stock": "In stock",
  "low-stock": "Low stock",
  "out-of-stock": "Out of stock"
};

function render(items) {
  if (!items.length) {
    els.summary.textContent = "0 items saved";
    els.list.innerHTML =
      '<p class="empty">Your wishlist is empty. Add products from the browse page to see them here.</p>';
    return;
  }
  els.summary.textContent = `${items.length} item${items.length === 1 ? "" : "s"} saved`;
  els.list.innerHTML = items
    .map(
      (item) => `
      <article class="wishlist-row" data-id="${escapeHTML(item.id)}">
        <div class="table-product">
          <div class="table-thumb">
            ${
              item.imageUrl
                ? `<img src="${escapeHTML(item.imageUrl)}" alt="${escapeHTML(item.name)}"
                     onerror="this.style.display='none'" />`
                : ""
            }
          </div>
          <div>
            <h3>${escapeHTML(item.name)}</h3>
            <p>${escapeHTML(item.shopName || "Unknown shop")} · ${escapeHTML(item.category)}</p>
          </div>
        </div>
        <div class="wishlist-right">
          <span class="price">₹${item.price.toFixed(2)} <small>/ ${escapeHTML(item.unit)}</small></span>
          <span class="stock-status ${item.status}">${STATUS_LABEL[item.status]}</span>
        </div>
        <button class="btn btn-quiet btn-small" data-action="remove">Remove</button>
      </article>`
    )
    .join("");
}

async function loadWishlist() {
  const data = await api.get("/api/wishlist");
  render(data.items);
}

els.list.addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-action="remove"]');
  if (!button) return;
  const id = button.closest(".wishlist-row").dataset.id;
  try {
    await api.delete(`/api/wishlist/${encodeURIComponent(id)}`);
    showToast("Removed from your wishlist.");
    await loadWishlist();
  } catch (error) {
    showToast(error.message);
  }
});

(async function start() {
  await setupHeader();
  const user = await loadUser();
  if (!user || user.role !== "customer") {
    window.location.href = "/login.html";
    return;
  }
  await loadWishlist();
})();
