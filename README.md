# FlopDroid Store — Firebase Edition Setup Guide

Real accounts, real shared currency, real database — synced across every
device, not just one browser. Backed by Firebase Authentication + Firestore
(free tier).

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com → **Add project** → name it
   whatever you like (e.g. "flopdroid-store") → you can skip Google Analytics.
2. **Build → Authentication → Get started** → click the **Email/Password**
   provider → enable it → Save.
3. **Build → Firestore Database → Create database** → choose a region close
   to your players → start in **production mode** (we're giving you real
   rules below, you don't need test mode).
4. Click the gear icon (top left) → **Project settings** → scroll to
   **Your apps** → click the `</>` (Web) icon → give it any nickname →
   **Register app**. It'll show you a `firebaseConfig` object — copy it.

## 2. Paste your config

Open `assets/firebase-config.js` and replace the placeholder values with
what you copied:

```js
const firebaseConfig = {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "..."
};
```

## 3. Set the security rules

In the Firebase console: **Build → Firestore Database → Rules** tab → delete
everything there → paste in the entire contents of `firestore.rules` (included
in this folder) → **Publish**.

These rules are what actually make this safe to put on the internet:
- A normal user can read their own account, but can never write `isAdmin: true`
  on themselves, and can never directly increase their own currency.
- Currency can only go **up** for a normal user in one specific way: redeeming
  a code that really exists, for exactly the amount that code is worth.
- Currency can only go **up for anyone in any amount** if done by an admin
  (the Users & Currency tab).
- Products are publicly readable (so the store works for visitors) but only
  admins can create/edit/delete them.
- A user can only see their own orders and cart; admins can see everyone's.

## 4. File placement (same as before)

```
WebSite/
└── Pages/
    ├── store.html
    ├── admin.html
    └── assets/
        ├── firebase-config.js   ← new, your project's config
        ├── db.js                 (now Firebase-backed)
        ├── store.js
        ├── admin.js
        └── store-style.css
```

`store.html` and `admin.html` now load `db.js`/`store.js`/`admin.js` as ES
modules (`<script type="module">`) — that's required for the Firebase SDK
imports to work, and it's already set up in the files I gave you.

## 5. Make yourself admin

There's no more "first account becomes admin" trick — with a real database,
that's not something you want to leave automatic. Instead:

1. Open `store.html`, sign up for a normal account.
2. In the Firebase console: **Build → Firestore Database → Data** →
   `users` collection → find your document (it's keyed by a random ID —
   check the `username` field to find the right one) → click it → edit the
   `isAdmin` field → set it to `true` (boolean, not text).
3. Sign out and back in on the site (or just refresh) → open `admin.html`.

## 6. Test it

- Sign up two different test accounts, confirm they can't see or spend each
  other's currency.
- As admin, grant one of them some FlopCoins, buy something with it, check
  the order shows up in the Orders tab.
- Try creating and redeeming a code.
- Optional but recommended: open the **Rules Playground** (next to the Rules
  tab in Firestore) and simulate a non-admin trying to write `currency: 999999`
  to their own doc — it should be denied.

## Hardening further (optional, later)

The current setup blocks the obvious attacks (self-granting currency, editing
someone else's account, forging admin status) using only Firestore's security
rules — no server code required. The one soft spot: technically, someone
could try to write an `orders` document directly (bypassing the site's
checkout flow) without an equivalent currency deduction happening. The rules
require that order's `total` not exceed their *currently stored* balance, which
blocks the obvious version of this, but a fully airtight version needs a
**Cloud Function** that runs checkout entirely server-side.

If you want that later: I can write you a `checkout` Cloud Function — it
requires upgrading your Firebase project to the **Blaze (pay-as-you-go)** plan,
but for a small server's traffic you'd realistically stay within the free
monthly quota and pay $0. Until then, just eyeball an order's total against
the buyer's balance in the admin panel before marking it delivered — normal
players will never trigger this path, it only matters against someone
deliberately poking at your database with dev tools.

## Configuration

Same as before — edit `CONFIG` inside `assets/db.js` for the currency name/
symbol.

## What changed from the localStorage version

- `db.js` is completely rewritten (Firebase Auth + Firestore instead of
  `localStorage`) but exposes the exact same `DB.auth.signUp()`,
  `DB.products.list()`, `DB.orders.checkout()`, etc. — `store.js` and
  `admin.js` needed almost no changes.
- Sign-in is now **username only** (no more "username or email") — Firebase
  needs an email under the hood, so we generate one privately from the
  username; your real email field (optional at signup) is just kept for your
  own reference, it's not used to log in.
- The old `assets/db.localstorage-backup.js` file is the previous version,
  kept only for reference — it's not loaded by anything, safe to delete.
