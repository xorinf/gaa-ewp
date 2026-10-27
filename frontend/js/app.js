// Shared helpers used by every page: API calls, session state and small
// DOM utilities.

const api = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || "Something went wrong.");
      error.status = response.status;
      throw error;
    }
    return data;
  },
  get(path) {
    return api.request(path);
  },
  post(path, body) {
    return api.request(path, { method: "POST", body: JSON.stringify(body) });
  },
  patch(path, body) {
    return api.request(path, { method: "PATCH", body: JSON.stringify(body) });
  },
  delete(path) {
    return api.request(path, { method: "DELETE" });
  }
};

// Escapes text before it is put into innerHTML.
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

// The signed-in user, or null. Cached after the first call.
let currentUser = null;
let userLoaded = false;

async function loadUser() {
  if (userLoaded) return currentUser;
  try {
    const data = await api.get("/api/auth/me");
    currentUser = data.user;
  } catch {
    currentUser = null;
  }
  userLoaded = true;
  return currentUser;
}

function resetUser() {
  currentUser = null;
  userLoaded = false;
}

// Shows the right links in the header for the signed-in role.
async function setupHeader() {
  const user = await loadUser();
  const loginLink = document.getElementById("loginLink");
  const logoutBtn = document.getElementById("logoutBtn");
  const wishlistLink = document.getElementById("wishlistLink");
  const shopLink = document.getElementById("shopLink");

  if (user) {
    if (loginLink) loginLink.hidden = true;
    if (logoutBtn) {
      logoutBtn.hidden = false;
      logoutBtn.addEventListener("click", async () => {
        await api.post("/api/auth/logout");
        resetUser();
        window.location.href = "/";
      });
    }
    if (wishlistLink) wishlistLink.hidden = user.role !== "customer";
    if (shopLink) shopLink.hidden = user.role !== "owner";
  }
}

let toastTimer;
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

// Shows a message inside a .form-message element.
function showFormMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  element.classList.toggle("error", isError);
}
