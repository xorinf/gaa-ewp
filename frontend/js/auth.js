// Login and registration page.

const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const loginMessage = document.getElementById("loginMessage");
const registerMessage = document.getElementById("registerMessage");
const roleSelect = document.getElementById("roleSelect");
const shopFields = document.getElementById("shopFields");

function showTab(tab) {
  const isLogin = tab === "login";
  loginTab.setAttribute("aria-selected", String(isLogin));
  registerTab.setAttribute("aria-selected", String(!isLogin));
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  showFormMessage(loginMessage, "");
  showFormMessage(registerMessage, "");
}

loginTab.addEventListener("click", () => showTab("login"));
registerTab.addEventListener("click", () => showTab("register"));

// Shop fields only make sense for owners.
roleSelect.addEventListener("change", () => {
  const isOwner = roleSelect.value === "owner";
  shopFields.classList.toggle("hidden", !isOwner);
  shopFields.querySelectorAll("input").forEach((input) => {
    input.required = isOwner && input.name === "shopName";
  });
});

// Sends the user to the page that matches their role.
function goAfterAuth(user) {
  window.location.href = user.role === "owner" ? "/shop.html" : "/";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm).entries());
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api.post("/api/auth/login", data);
    showFormMessage(loginMessage, "Signed in.");
    goAfterAuth(result.user);
  } catch (error) {
    showFormMessage(loginMessage, error.message, true);
    button.disabled = false;
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(registerForm).entries());
  const button = registerForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api.post("/api/auth/register", data);
    showFormMessage(registerMessage, "Account created.");
    goAfterAuth(result.user);
  } catch (error) {
    showFormMessage(registerMessage, error.message, true);
    button.disabled = false;
  }
});
