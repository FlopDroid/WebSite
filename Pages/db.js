/* =========================================================
   FlopDroid Store — Data Layer
   ---------------------------------------------------------
   Everything in this file talks to localStorage right now.
   Every function returns a Promise on purpose — even though
   localStorage is instant — so that later, when you plug in
   a real backend (Firebase, your own API, etc.), you only
   have to rewrite the INSIDE of these functions. Every other
   file (store.js, admin.js, store.html, admin.html) calls
   DB.whatever(...) and never touches localStorage directly,
   so nothing else needs to change.

   See UPGRADE-GUIDE.md for exactly what to replace when
   you're ready to go live with a real backend.
   ========================================================= */

const CONFIG = {
    siteName: "FlopDroid",
    currencyName: "FlopCoins",
    currencySymbol: "🪙",
    // First account ever created on this browser becomes admin.
    // Change this any time from the Admin panel afterwards.
    minecraftUsernameRequired: true
};

const DB = (() => {

    const KEYS = {
        users: "fd_users",
        session: "fd_session",
        products: "fd_products",
        orders: "fd_orders",
        codes: "fd_codes"
    };

    /* ---------- low level storage helpers ---------- */

    function read(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            console.error("DB read error", key, e);
            return fallback;
        }
    }

    function write(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function uid(prefix = "id") {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function delay() {
        // tiny artificial delay so UI code that shows loading
        // states behaves the same way it will against a real backend
        return new Promise(res => setTimeout(res, 120));
    }

    async function hashPassword(password, salt) {
        const enc = new TextEncoder();
        const data = enc.encode(`fd::${salt}::${password}`);
        const digest = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    /* ---------- seed default products the first time ---------- */

    function ensureSeedData() {
        if (!localStorage.getItem(KEYS.products)) {
            write(KEYS.products, [
                {
                    id: uid("prod"),
                    name: "VIP Rank",
                    description: "Colored name, extra /home slots, and a VIP tag in chat.",
                    image: "https://raw.githubusercontent.com/FlopDroid/WebSite/refs/heads/main/Images/Icons/flopdroid-event-logo.png",
                    price: 500,
                    category: "Ranks",
                    stock: null,
                    active: true
                },
                {
                    id: uid("prod"),
                    name: "50x Diamond Crate Key",
                    description: "Redeemable in-game at spawn for a Diamond Crate.",
                    image: "https://raw.githubusercontent.com/FlopDroid/WebSite/refs/heads/main/Images/Icons/flopdroid-event-logo.png",
                    price: 250,
                    category: "Crates",
                    stock: 50,
                    active: true
                },
                {
                    id: uid("prod"),
                    name: "Custom Player Title",
                    description: "Pick any short custom title shown next to your name.",
                    image: "https://raw.githubusercontent.com/FlopDroid/WebSite/refs/heads/main/Images/Icons/flopdroid-event-logo.png",
                    price: 150,
                    category: "Cosmetics",
                    stock: null,
                    active: true
                }
            ]);
        }
        if (!localStorage.getItem(KEYS.users)) write(KEYS.users, []);
        if (!localStorage.getItem(KEYS.orders)) write(KEYS.orders, []);
        if (!localStorage.getItem(KEYS.codes)) write(KEYS.codes, []);
    }
    ensureSeedData();

    /* =========================================================
       AUTH
       ========================================================= */

    const auth = {
        async signUp({ username, email, minecraftUsername, password }) {
            await delay();
            username = (username || "").trim();
            email = (email || "").trim().toLowerCase();
            minecraftUsername = (minecraftUsername || "").trim();

            if (!username || !password) return { ok: false, error: "Username and password are required." };
            if (CONFIG.minecraftUsernameRequired && !minecraftUsername) {
                return { ok: false, error: "Minecraft username is required so we know who to deliver items to." };
            }

            const users = read(KEYS.users, []);
            if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
                return { ok: false, error: "That username is already taken." };
            }
            if (email && users.some(u => u.email === email)) {
                return { ok: false, error: "That email is already registered." };
            }

            const passwordHash = await hashPassword(password, username.toLowerCase());
            const user = {
                id: uid("user"),
                username,
                email,
                minecraftUsername,
                passwordHash,
                currency: 0,
                isAdmin: users.length === 0, // first ever account becomes admin
                createdAt: Date.now()
            };
            users.push(user);
            write(KEYS.users, users);
            write(KEYS.session, { userId: user.id });
            return { ok: true, user: publicUser(user) };
        },

        async signIn({ usernameOrEmail, password }) {
            await delay();
            const users = read(KEYS.users, []);
            const needle = (usernameOrEmail || "").trim().toLowerCase();
            const user = users.find(u => u.username.toLowerCase() === needle || u.email === needle);
            if (!user) return { ok: false, error: "No account found with that username or email." };

            const hash = await hashPassword(password, user.username.toLowerCase());
            if (hash !== user.passwordHash) return { ok: false, error: "Incorrect password." };

            write(KEYS.session, { userId: user.id });
            return { ok: true, user: publicUser(user) };
        },

        async signOut() {
            await delay();
            localStorage.removeItem(KEYS.session);
            return { ok: true };
        },

        currentUser() {
            const session = read(KEYS.session, null);
            if (!session) return null;
            const users = read(KEYS.users, []);
            const user = users.find(u => u.id === session.userId);
            return user ? publicUser(user) : null;
        }
    };

    function publicUser(user) {
        // strip the password hash before handing the object to UI code
        const { passwordHash, ...safe } = user;
        return safe;
    }

    /* =========================================================
       PRODUCTS
       ========================================================= */

    const products = {
        async list({ onlyActive = false } = {}) {
            await delay();
            const all = read(KEYS.products, []);
            return onlyActive ? all.filter(p => p.active) : all;
        },
        async get(id) {
            await delay();
            return read(KEYS.products, []).find(p => p.id === id) || null;
        },
        async upsert(product) {
            await delay();
            const all = read(KEYS.products, []);
            if (product.id) {
                const idx = all.findIndex(p => p.id === product.id);
                if (idx === -1) return { ok: false, error: "Product not found." };
                all[idx] = { ...all[idx], ...product };
            } else {
                product.id = uid("prod");
                product.active = product.active !== false;
                all.push(product);
            }
            write(KEYS.products, all);
            return { ok: true, product };
        },
        async remove(id) {
            await delay();
            write(KEYS.products, read(KEYS.products, []).filter(p => p.id !== id));
            return { ok: true };
        }
    };

    /* =========================================================
       CART  (per user, stored inline on the user record's id)
       ========================================================= */

    function cartKey(userId) { return `fd_cart_${userId}`; }

    const cart = {
        async get(userId) {
            await delay();
            return read(cartKey(userId), []); // [{productId, qty}]
        },
        async setQty(userId, productId, qty) {
            await delay();
            let items = read(cartKey(userId), []);
            if (qty <= 0) {
                items = items.filter(i => i.productId !== productId);
            } else {
                const existing = items.find(i => i.productId === productId);
                if (existing) existing.qty = qty;
                else items.push({ productId, qty });
            }
            write(cartKey(userId), items);
            return items;
        },
        async clear(userId) {
            await delay();
            write(cartKey(userId), []);
        }
    };

    /* =========================================================
       ORDERS
       ========================================================= */

    const orders = {
        async checkout(userId) {
            await delay();
            const users = read(KEYS.users, []);
            const user = users.find(u => u.id === userId);
            if (!user) return { ok: false, error: "You need to be signed in." };

            const items = read(cartKey(userId), []);
            if (items.length === 0) return { ok: false, error: "Your cart is empty." };

            const allProducts = read(KEYS.products, []);
            let total = 0;
            const lineItems = [];
            for (const item of items) {
                const p = allProducts.find(p => p.id === item.productId);
                if (!p) continue;
                if (typeof p.stock === "number" && p.stock < item.qty) {
                    return { ok: false, error: `Not enough stock for "${p.name}".` };
                }
                total += p.price * item.qty;
                lineItems.push({ productId: p.id, name: p.name, price: p.price, qty: item.qty });
            }

            if (user.currency < total) {
                return { ok: false, error: `Not enough ${CONFIG.currencyName}. You need ${total - user.currency} more.` };
            }

            // deduct currency
            user.currency -= total;
            write(KEYS.users, users);

            // reduce stock
            lineItems.forEach(li => {
                const p = allProducts.find(p => p.id === li.productId);
                if (p && typeof p.stock === "number") p.stock -= li.qty;
            });
            write(KEYS.products, allProducts);

            // create order
            const order = {
                id: uid("order"),
                userId: user.id,
                username: user.username,
                minecraftUsername: user.minecraftUsername,
                items: lineItems,
                total,
                status: "pending",
                createdAt: Date.now()
            };
            const all = read(KEYS.orders, []);
            all.unshift(order);
            write(KEYS.orders, all);

            // clear cart
            write(cartKey(userId), []);

            return { ok: true, order, newBalance: user.currency };
        },

        async listByUser(userId) {
            await delay();
            return read(KEYS.orders, []).filter(o => o.userId === userId);
        },

        async listAll() {
            await delay();
            return read(KEYS.orders, []);
        },

        async setStatus(orderId, status) {
            await delay();
            const all = read(KEYS.orders, []);
            const order = all.find(o => o.id === orderId);
            if (!order) return { ok: false, error: "Order not found." };
            order.status = status;
            write(KEYS.orders, all);
            return { ok: true, order };
        }
    };

    /* =========================================================
       USERS (admin management)
       ========================================================= */

    const users = {
        async list() {
            await delay();
            return read(KEYS.users, []).map(publicUser);
        },
        async get(userId) {
            await delay();
            const u = read(KEYS.users, []).find(u => u.id === userId);
            return u ? publicUser(u) : null;
        },
        async grantCurrency(userId, amount, note = "") {
            await delay();
            const all = read(KEYS.users, []);
            const user = all.find(u => u.id === userId);
            if (!user) return { ok: false, error: "User not found." };
            user.currency = Math.max(0, user.currency + amount);
            write(KEYS.users, all);
            return { ok: true, newBalance: user.currency };
        },
        async setAdmin(userId, isAdmin) {
            await delay();
            const all = read(KEYS.users, []);
            const user = all.find(u => u.id === userId);
            if (!user) return { ok: false, error: "User not found." };
            user.isAdmin = !!isAdmin;
            write(KEYS.users, all);
            return { ok: true };
        }
    };

    /* =========================================================
       REDEEM CODES
       (This is the natural place to later hook up your Minecraft
        server: have your plugin call an API that creates a code
        server-side when a player earns currency in-game, then
        the player redeems it here. See UPGRADE-GUIDE.md.)
       ========================================================= */

    const codes = {
        async create({ code, amount, maxUses }) {
            await delay();
            const all = read(KEYS.codes, []);
            code = (code || "").trim().toUpperCase();
            if (!code) return { ok: false, error: "Code text is required." };
            if (all.some(c => c.code === code)) return { ok: false, error: "That code already exists." };
            all.push({ code, amount: Number(amount) || 0, maxUses: Number(maxUses) || 1, usedBy: [], createdAt: Date.now() });
            write(KEYS.codes, all);
            return { ok: true };
        },
        async list() {
            await delay();
            return read(KEYS.codes, []);
        },
        async remove(code) {
            await delay();
            write(KEYS.codes, read(KEYS.codes, []).filter(c => c.code !== code));
            return { ok: true };
        },
        async redeem(userId, codeText) {
            await delay();
            const all = read(KEYS.codes, []);
            const code = all.find(c => c.code === (codeText || "").trim().toUpperCase());
            if (!code) return { ok: false, error: "That code doesn't exist." };
            if (code.usedBy.includes(userId)) return { ok: false, error: "You've already used this code." };
            if (code.usedBy.length >= code.maxUses) return { ok: false, error: "This code has reached its use limit." };

            code.usedBy.push(userId);
            write(KEYS.codes, all);

            const allUsers = read(KEYS.users, []);
            const user = allUsers.find(u => u.id === userId);
            user.currency += code.amount;
            write(KEYS.users, allUsers);

            return { ok: true, amount: code.amount, newBalance: user.currency };
        }
    };

    return { auth, products, cart, orders, users, codes };
})();
