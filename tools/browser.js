"use strict";

// Dev helper: drives headless Chrome over the DevTools protocol to take
// screenshots and check the pages. Node 18+ only - no extra dependencies.
//
//   node tools/browser.js shot <url> <out.png> [email:password] [width] [height]
//   node tools/browser.js flow <baseUrl>

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

function findChrome() {
  const candidates = [process.env.CHROME_PATH, ...CHROME_CANDIDATES].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  console.error("Chrome not found. Set CHROME_PATH to your browser binary.");
  process.exit(1);
}

// Starts Chrome with the remote debugging port open and returns the page target.
async function startChrome(port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gaa-chrome-"));
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--hide-scrollbars",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const tabs = await response.json();
      const page = tabs.find((tab) => tab.type === "page");
      if (page) return { chrome, target: page };
    } catch {
      // Chrome is not listening yet.
    }
  }
  throw new Error("Chrome did not start.");
}

// A very small CDP client over the built-in WebSocket.
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const resolver = pending.get(message.id);
      if (!resolver) return;
      pending.delete(message.id);
      if (message.error) resolver.reject(new Error(message.error.message));
      else resolver.resolve(message.result || {});
    });
    socket.addEventListener("error", reject);
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
        },
        close: () => socket.close()
      });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const mode = process.argv[2];
  const port = 9600 + (process.pid % 300);

  if (mode === "shot") {
    const [url, out, login = "", width = "1280", height = "900"] = process.argv.slice(3);
    const { chrome, target } = await startChrome(port);
    try {
      const cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: Number(width),
        height: Number(height),
        deviceScaleFactor: 2,
        mobile: false
      });

      if (login) {
        const origin = new URL(url).origin;
        await cdp.send("Page.navigate", { url: origin });
        await sleep(1500);
        const [email, password] = login.split(":");
        await evaluate(cdp, `
          fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }) })
            .then(r => r.status)
        `, true);
      }

      await cdp.send("Page.navigate", { url });
      await sleep(2500);

      const info = await evaluate(
        cdp,
        `JSON.stringify({ title: document.title, cards: document.querySelectorAll('.product-card').length,
           text: document.body.innerText.slice(0, 400) })`
      );
      console.log(info);

      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
      console.log(`saved ${out}`);
      cdp.close();
    } finally {
      chrome.kill();
    }
    return;
  }

  if (mode === "flow") {
    const base = process.argv[3] || "http://localhost:41777";
    const { chrome, target } = await startChrome(port);
    try {
      const cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      });

      await cdp.send("Page.navigate", { url: base + "/" });
      await sleep(1500);
      console.log("login:", await evaluate(cdp, `
        fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'customer@example.com', password: 'demo1234' }) }).then(r => r.status)
      `, true));

      await cdp.send("Page.navigate", { url: base + "/" });
      await sleep(2500);

      console.log("wishlist link visible:", await evaluate(cdp, `!document.getElementById('wishlistLink').hidden`));
      console.log("cards:", await evaluate(cdp, `document.querySelectorAll('.product-card').length`));
      console.log("images loaded:", await evaluate(cdp, `
        Array.from(document.querySelectorAll('.product-image img')).filter(i => i.complete && i.naturalWidth > 0).length
      `));

      await evaluate(cdp, `document.querySelector('[data-action="wishlist"]').click()`);
      await sleep(1200);
      console.log("button after click:", await evaluate(cdp, `document.querySelector('[data-action="wishlist"]').textContent.trim()`));
      console.log("toast:", await evaluate(cdp, `document.getElementById('toast').textContent`));

      await cdp.send("Page.navigate", { url: base + "/" });
      await sleep(2500);
      console.log("after reload:", await evaluate(cdp, `document.querySelector('[data-action="wishlist"]').textContent.trim()`));

      await cdp.send("Page.navigate", { url: base + "/wishlist.html" });
      await sleep(2000);
      console.log("wishlist summary:", await evaluate(cdp, `document.getElementById('wishlistSummary').textContent`));
      console.log("wishlist rows:", await evaluate(cdp, `document.querySelectorAll('.wishlist-row').length`));

      await cdp.send("Page.navigate", { url: base + "/" });
      await sleep(2000);
      await evaluate(cdp, `
        (() => { const i = document.getElementById('searchInput'); i.value = 'rice';
          i.dispatchEvent(new Event('input')); })()
      `);
      await sleep(1200);
      console.log("search 'rice':", await evaluate(cdp, `document.getElementById('resultCount').textContent`));

      await evaluate(cdp, `
        (() => { const s = document.getElementById('typeFilter'); s.value = 'household';
          s.dispatchEvent(new Event('change')); })()
      `);
      await sleep(1200);
      console.log("type household:", await evaluate(cdp, `document.getElementById('resultCount').textContent`));
      cdp.close();
    } finally {
      chrome.kill();
    }
    return;
  }

  if (mode === "owner") {
    // Add a product through the owner form and check it lands in the table.
    const base = process.argv[3] || "http://localhost:41777";
    const { chrome, target } = await startChrome(port);
    try {
      const cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

      await cdp.send("Page.navigate", { url: base + "/" });
      await sleep(1500);
      console.log("login:", await evaluate(cdp, `
        fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner1@example.com', password: 'demo1234' }) }).then(r => r.status)
      `, true));

      await cdp.send("Page.navigate", { url: base + "/shop.html" });
      await sleep(2500);
      console.log("rows before:", await evaluate(cdp, `document.querySelectorAll('#inventoryBody tr').length`));

      await evaluate(cdp, `document.getElementById('toggleFormBtn').click()`);
      await sleep(400);
      console.log("form open:", await evaluate(cdp, `!document.getElementById('addForm').classList.contains('hidden')`));

      // Fill the form the way a person would.
      await evaluate(cdp, `
        (() => {
          const form = document.getElementById('addForm');
          form.querySelector('[name="name"]').value = 'Samosa';
          form.querySelector('[name="type"]').value = 'grocery';
          form.querySelector('[name="type"]').dispatchEvent(new Event('change'));
          form.querySelector('[name="price"]').value = '60';
          form.querySelector('[name="stock"]').value = '9';
          form.querySelector('[name="imageUrl"]').value = 'https://picsum.photos/seed/samosa/600/400';
        })()
      `);
      await sleep(300);
      console.log("categories for grocery:", await evaluate(cdp, `
        Array.from(document.getElementById('productCategory').options).map(o => o.value).join('|')
      `));
      console.log("units for grocery:", await evaluate(cdp, `
        Array.from(document.getElementById('productUnit').options).map(o => o.value).join('|')
      `));

      await evaluate(cdp, `
        (() => {
          const form = document.getElementById('addForm');
          form.querySelector('[name="category"]').value = 'Snacks';
          form.requestSubmit();
        })()
      `);
      await sleep(2000);
      console.log("rows after:", await evaluate(cdp, `document.querySelectorAll('#inventoryBody tr').length`));
      console.log("samosa in table:", await evaluate(cdp, `
        document.getElementById('inventoryBody').innerText.includes('Samosa')
      `));
      console.log("status of new row:", await evaluate(cdp, `
        (() => { const rows = Array.from(document.querySelectorAll('#inventoryBody tr'));
          const row = rows.find(r => r.innerText.includes('Samosa'));
          return row ? row.querySelector('.stock-status').textContent.trim() : 'not found'; })()
      `));

      // Edit the price of the new row and save.
      await evaluate(cdp, `
        (() => { const rows = Array.from(document.querySelectorAll('#inventoryBody tr'));
          const row = rows.find(r => r.innerText.includes('Samosa'));
          row.querySelector('[data-field="price"]').value = '75';
          row.querySelector('[data-field="stock"]').value = '2';
          row.querySelector('button[data-action="save"]').click(); })()
      `);
      await sleep(2000);
      console.log("after save:", await evaluate(cdp, `
        (() => { const rows = Array.from(document.querySelectorAll('#inventoryBody tr'));
          const row = rows.find(r => r.innerText.includes('Samosa'));
          return row ? row.querySelector('[data-field="price"]').value + ' / ' +
            row.querySelector('[data-field="stock"]').value + ' / ' +
            row.querySelector('.stock-status').textContent.trim() : 'not found'; })()
      `));
      console.log("toast:", await evaluate(cdp, `document.getElementById('toast').textContent`));
      cdp.close();
    } finally {
      chrome.kill();
    }
    return;
  }

  if (mode === "register") {
    // Switch to the register tab and check the owner fields appear.
    const base = process.argv[3] || "http://localhost:41777";
    const { chrome, target } = await startChrome(port);
    try {
      const cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Page.navigate", { url: base + "/login.html" });
      await sleep(2000);

      console.log("login tab visible:", await evaluate(cdp, `!document.getElementById('loginForm').classList.contains('hidden')`));
      await evaluate(cdp, `document.getElementById('registerTab').click()`);
      await sleep(400);
      console.log("register tab visible:", await evaluate(cdp, `!document.getElementById('registerForm').classList.contains('hidden')`));
      console.log("shop fields hidden for customer:", await evaluate(cdp, `document.getElementById('shopFields').classList.contains('hidden')`));

      await evaluate(cdp, `
        (() => { const s = document.getElementById('roleSelect'); s.value = 'owner';
          s.dispatchEvent(new Event('change')); })()
      `);
      await sleep(300);
      console.log("shop fields shown for owner:", await evaluate(cdp, `!document.getElementById('shopFields').classList.contains('hidden')`));
      console.log("shop name required:", await evaluate(cdp, `document.querySelector('[name="shopName"]').required`));

      // Submit with a bad email and check the error message shows.
      await evaluate(cdp, `
        (() => { const f = document.getElementById('registerForm');
          f.querySelector('[name="name"]').value = 'Test Owner';
          f.querySelector('[name="email"]').value = 'not-an-email';
          f.querySelector('[name="password"]').value = 'secret123';
          f.querySelector('[name="shopName"]').value = 'Test Shop';
          f.requestSubmit(); })()
      `);
      await sleep(1500);
      console.log("error shown:", await evaluate(cdp, `document.getElementById('registerMessage').textContent`));
      cdp.close();
    } finally {
      chrome.kill();
    }
    return;
  }

  console.log("Usage: node tools/browser.js shot <url> <out.png> [email:password] [w] [h]");
  console.log("       node tools/browser.js flow <baseUrl>");
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result ? result.result.value : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
