# Grocery Availability

A web app where customers check what is in stock at nearby shops and shop owners
manage their own inventory. Built with **HTML, CSS, vanilla JavaScript, Node.js,
Express, XML and the Fetch API**. All data lives in XML files that are validated
against DTDs.

## Features

**Customers**
- Register and sign in
- Browse all shops and their products
- Search by product name, filter by type, category or shop
- See price, unit and live stock status
- Add and remove products from a personal wishlist

**Shop owners**
- Register a shop and sign in
- Add products with name, type, category, unit, price, stock and an optional image URL
- Edit price and stock, or delete a product
- See how many distinct customers wishlisted each product

**Stock status** is derived automatically: `0` is Out of stock, `1–5` is Low stock,
`6+` is In stock (the threshold is `LOW_STOCK_THRESHOLD` in `backend/catalog.js`).

## Project layout

```
backend/
  server.js      Express app and all API routes
  store.js       Reads/writes the XML files and validates them against the DTDs
  auth.js        Password hashing (scrypt) and signed session cookies
  catalog.js     Product types, categories, units and the stock threshold
  seed.js        Demo data
  test.js        End-to-end API tests
  dtd/           One DTD per XML file
frontend/
  index.html     Browse page
  login.html     Sign in / register
  shop.html      Shop owner dashboard
  wishlist.html  Customer wishlist
  css/style.css  All styling
  js/            app.js (shared helpers) + one script per page
tools/
  browser.js     Dev helper for screenshots and click-through checks
```

## Run it locally

```bash
npm install
npm run seed     # creates backend/data with demo shops and products
npm start        # http://localhost:3000
```

`npm run seed` is optional - the server seeds itself the first time it finds an
empty data folder.

### Demo accounts

Password for all of them is `demo1234`:

| Email | Role |
| --- | --- |
| `customer@example.com` | Customer |
| `owner1@example.com` | Shop owner (GreenLeaf Market) |
| `owner2@example.com` | Shop owner (Daily Needs Store) |

### Environment variables

Copy `.env.example` to `.env` and edit it. All of them are optional.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Port to listen on | `3000` |
| `SESSION_SECRET` | Signs the session cookie | random, stored on disk |
| `DATA_DIR` | Folder holding the XML files | `backend/data` |
| `NODE_ENV` | Set to `production` when deploying | `development` |

## How it works

**Storage.** Four XML files hold everything: `users.xml`, `shops.xml`,
`products.xml` and `wishlists.xml`. Each has a matching DTD in `backend/dtd/`.
`store.js` validates a file against its DTD *before* writing it, so a malformed
record can never reach disk. You can check the files with any standard tool:

```bash
xmllint --valid --noout backend/data/products.xml
```

**Auth.** Passwords are hashed with `scrypt` and a per-user salt
(`salt:hash` is stored in `users.xml`). On sign-in the server sets an
`HttpOnly` signed cookie. Owner-only routes are protected by middleware, so a
customer calling `/api/owner/products` gets a 401.

**Stock status and wishlist counts** are computed from the XML on each request,
so there is never a stale value in the database.

## API

| Method | Endpoint | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | anyone | Health check |
| GET | `/api/catalog` | anyone | Product types, categories, units, threshold |
| POST | `/api/auth/register` | anyone | Create a customer or owner account |
| POST | `/api/auth/login` | anyone | Sign in |
| POST | `/api/auth/logout` | anyone | Sign out |
| GET | `/api/auth/me` | anyone | The signed-in user |
| GET | `/api/shops` | anyone | Shops with product and stock counts |
| GET | `/api/products` | anyone | Products, filtered by `q`, `type`, `category`, `shopId` |
| GET | `/api/products/:id` | anyone | One product with its wishlist count |
| GET | `/api/wishlist` | customer | The signed-in customer's wishlist |
| POST | `/api/wishlist` | customer | Add a product (`{ productId }`) |
| DELETE | `/api/wishlist/:productId` | customer | Remove a product |
| GET | `/api/owner/shop` | owner | The owner's shop |
| GET | `/api/owner/products` | owner | Own inventory with wishlist counts |
| POST | `/api/owner/products` | owner | Add a product |
| PATCH | `/api/owner/products/:id` | owner | Change price, stock or image URL |
| DELETE | `/api/owner/products/:id` | owner | Remove a product |

## Tests

```bash
npm test
```

17 end-to-end tests covering registration, login, role checks, wishlist counts,
validation, search and DTD validation. They run in a temporary folder and never
touch `backend/data`.

## Deploy to Render

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint**, pick the repo, and Render reads
   `render.yaml` and sets everything up.
3. Render creates the persistent disk and the `SESSION_SECRET` for you.

To set it up by hand instead:

- Create a **Web Service** pointing at the repo.
- Build command: `npm ci --omit=dev`
- Start command: `npm start`
- Add the env vars from `.env.example`. Set `DATA_DIR` to the mount path of a
  **persistent disk** (for example `/var/data`) so the XML files survive
  restarts and redeployments.
- Health check path: `/api/health`

A fresh deployment seeds itself with the demo data on first start.

### Persistent storage needs a paid plan

Render's free plan has an ephemeral filesystem, and persistent disks are only
available on the **Starter** plan or above ($7/month). Until a card is added to
the Render account, `DATA_DIR` cannot be created and the app falls back to a
folder inside the project, so **the data is lost on every restart and
redeploy**. The app logs a warning when this happens.

To get real persistence:

1. Add a card at <https://dashboard.render.com/billing>.
2. Attach a disk to the service, mounted at `/var/data` (the Dashboard's
   **Disks** tab), or apply `render.yaml` as a Blueprint, which creates one.

The rest of the app works either way - only the data lifetime changes.

### A note on `npm ci`

The project ships an `.npmrc` that sets `legacy-peer-deps=false`. Without it,
a developer whose global `~/.npmrc` sets `legacy-peer-deps=true` generates a
lockfile with a different dependency tree, and `npm ci` then fails on Render
with "Missing: ... from lock file".

## Notes and limits

- The data directory is written to on every change with no locking, so run a
  single instance. A database would be the next step for real traffic.
- Sessions live in a signed cookie, so signing in again is needed after the
  secret changes.
- Product images are loaded from the URL the owner saves. Only `http://` and
  `https://` URLs are accepted.
- A product's wishlist count is only shown to the owner of the shop it belongs
  to, so customer interest is not visible to other customers or visitors.

## Dev helper

`tools/browser.js` drives headless Chrome to take screenshots and click through
the pages. It is only used during development:

```bash
node tools/browser.js shot http://localhost:3000 /tmp/home.png
node tools/browser.js shot http://localhost:3000/shop.html /tmp/shop.png owner1@example.com:demo1234
node tools/browser.js flow http://localhost:3000
```
