// Shop owner dashboard: add products, edit price/stock, see wishlist counts.

const state = { products: [], types: {} };

const els = {
  shopName: document.getElementById("shopName"),
  shopAddress: document.getElementById("shopAddress"),
  statRow: document.getElementById("statRow"),
  body: document.getElementById("inventoryBody"),
  addForm: document.getElementById("addForm"),
  addMessage: document.getElementById("addMessage"),
  toggleFormBtn: document.getElementById("toggleFormBtn"),
  cancelFormBtn: document.getElementById("cancelFormBtn"),
  type: document.getElementById("productType"),
  category: document.getElementById("productCategory"),
  unit: document.getElementById("productUnit")
};

const STATUS_LABEL = {
  "in-stock": "In stock",
  "low-stock": "Low stock",
  "out-of-stock": "Out of stock"
};

// Fills the category and unit dropdowns for the chosen product type.
function updateTypeOptions() {
  const type = state.types[els.type.value];
  els.category.innerHTML = type.categories
    .map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`)
    .join("");
  els.unit.innerHTML = type.units
    .map((unit) => `<option value="${escapeHTML(unit)}">${escapeHTML(unit)}</option>`)
    .join("");
}

function renderStats() {
  const total = state.products.length;
  const low = state.products.filter((p) => p.status === "low-stock").length;
  const out = state.products.filter((p) => p.status === "out-of-stock").length;
  const wished = state.products.reduce((sum, p) => sum + p.wishlistCount, 0);
  els.statRow.innerHTML = [
    ["Products", total],
    ["Low stock", low],
    ["Out of stock", out],
    ["Wishlist hits", wished]
  ]
    .map(
      ([label, value]) => `
      <div class="stat">
        <strong>${value}</strong>
        <span>${label}</span>
      </div>`
    )
    .join("");
}

function renderInventory() {
  if (!state.products.length) {
    els.body.innerHTML = '<tr><td colspan="7">No products yet. Add your first one above.</td></tr>';
    return;
  }
  els.body.innerHTML = state.products
    .map(
      (product) => `
      <tr data-id="${escapeHTML(product.id)}">
        <td>
          <div class="table-product">
            <div class="table-thumb">
              ${
                product.imageUrl
                  ? `<img src="${escapeHTML(product.imageUrl)}" alt="${escapeHTML(product.name)}"
                       onerror="this.style.display='none'" />`
                  : ""
              }
            </div>
            <strong>${escapeHTML(product.name)}</strong>
          </div>
        </td>
        <td>${escapeHTML(product.category)}<br /><small>${escapeHTML(product.unit)}</small></td>
        <td><input type="number" min="0.01" step="0.01" value="${product.price}" data-field="price" /></td>
        <td><input type="number" min="0" step="1" value="${product.stock}" data-field="stock" /></td>
        <td><span class="stock-status ${product.status}">${STATUS_LABEL[product.status]}</span></td>
        <td class="wishlist-count">${product.wishlistCount} customer${product.wishlistCount === 1 ? "" : "s"}</td>
        <td>
          <button class="btn btn-outline btn-small" data-action="save">Save</button>
          <button class="btn btn-quiet btn-small" data-action="delete">Delete</button>
        </td>
      </tr>`
    )
    .join("");
}

async function loadShop() {
  const data = await api.get("/api/owner/shop");
  els.shopName.textContent = data.shop.name;
  els.shopAddress.textContent = data.shop.address || "";
}

async function loadProducts() {
  const data = await api.get("/api/owner/products");
  state.products = data.products;
  renderStats();
  renderInventory();
}

// Saves the edited price and stock of one product.
async function saveRow(row) {
  const id = row.dataset.id;
  const price = row.querySelector('[data-field="price"]').value;
  const stock = row.querySelector('[data-field="stock"]').value;
  try {
    await api.patch(`/api/owner/products/${encodeURIComponent(id)}`, { price, stock });
    showToast("Product updated.");
    await loadProducts();
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteProduct(id) {
  if (!confirm("Remove this product? Any wishlist entries for it are deleted too.")) return;
  try {
    await api.delete(`/api/owner/products/${encodeURIComponent(id)}`);
    showToast("Product removed.");
    await loadProducts();
  } catch (error) {
    showToast(error.message);
  }
}

els.body.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest("tr");
  if (button.dataset.action === "save") saveRow(row);
  if (button.dataset.action === "delete") deleteProduct(row.dataset.id);
});

els.type.addEventListener("change", updateTypeOptions);

els.toggleFormBtn.addEventListener("click", () => {
  els.addForm.classList.toggle("hidden");
  if (!els.addForm.classList.contains("hidden")) els.addForm.querySelector('[name="name"]').focus();
});
els.cancelFormBtn.addEventListener("click", () => {
  els.addForm.classList.add("hidden");
  els.addForm.reset();
  showFormMessage(els.addMessage, "");
});

els.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(els.addForm).entries());
  const button = els.addForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api.post("/api/owner/products", data);
    els.addForm.reset();
    els.addForm.classList.add("hidden");
    showFormMessage(els.addMessage, "");
    showToast("Product added.");
    await loadProducts();
  } catch (error) {
    showFormMessage(els.addMessage, error.message, true);
  } finally {
    button.disabled = false;
  }
});

(async function start() {
  await setupHeader();
  const user = await loadUser();
  if (!user || user.role !== "owner") {
    window.location.href = "/login.html";
    return;
  }
  const catalog = await api.get("/api/catalog");
  state.types = catalog.types;
  updateTypeOptions();
  await loadShop();
  await loadProducts();
})();
