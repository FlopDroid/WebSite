/* =========================================================
   FlopDroid Store — Data Layer (Firebase edition)
   ---------------------------------------------------------
   Same DB.something(...) API as the old localStorage version,
   so store.js / admin.js barely had to change. Real accounts,
   real shared currency, real database — now backed by
   Firebase Authentication + Firestore.

   IMPORTANT — read the security notes near ORDERS/CHECKOUT
   below. This is solid for a small hobby-server store, but
   isn't bulletproof against a determined attacker. See
   README.md "Hardening further" for the full story.
   ========================================================= */

import { auth, dbFirestore } from "./firebase-config.js";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut as fbSignOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, getDocs, query, where,
    runTransaction, serverTimestamp, increment,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const CONFIG = {
    siteName: "FlopDroid",
    currencyName: "FlopCoins",
    currencySymbol: "🪙"
};
window.CONFIG = CONFIG;

/* Firebase Auth needs an email. We don't want to force real emails
   on players, so we derive a private, deterministic "login email"
   from their chosen username. This also means Firebase itself
   enforces username uniqueness for us (duplicate username =
   duplicate login email = signup rejected automatically). */
function loginEmailFor(username) {
    return `${username.trim().toLowerCase()}@flopdroid-store.internal`;
}

const DB = (() => {

    let _cachedProfile = null;   // { id, username, minecraftUsername, currency, isAdmin, ... } or null
    let _readyResolve;
    const _ready = new Promise(res => { _readyResolve = res; });
    let _firstAuthEventHandled = false;

    onAuthStateChanged(auth, async (fbUser) => {
        if (fbUser) {
            try {
                const snap = await getDoc(doc(dbFirestore, "users", fbUser.uid));
                _cachedProfile = snap.exists() ? { id: fbUser.uid, ...snap.data() } : null;
            } catch (e) {
                console.error("Failed to load profile", e);
                _cachedProfile = null;
            }
        } else {
            _cachedProfile = null;
        }
        if (!_firstAuthEventHandled) {
            _firstAuthEventHandled = true;
            _readyResolve();
        }
    });

    /* =========================================================
       AUTH
       ========================================================= */

    const authApi = {
        // Call this once before reading currentUser() on page load —
        // Firebase auth state resolves asynchronously.
        ready() { return _ready; },

        async signUp({ username, minecraftUsername, email, password }) {
            username = (username || "").trim();
            minecraftUsername = (minecraftUsername || "").trim();
            if (!username || !password) return { ok: false, error: "Username and password are required." };
            if (!minecraftUsername) return { ok: false, error: "Minecraft username is required so we know who to deliver items to." };

            let cred;
            try {
                cred = await createUserWithEmailAndPassword(auth, loginEmailFor(username), password);
            } catch (e) {
                if (e.code === "auth/email-already-in-use") return { ok: false, error: "That username is already taken." };
                if (e.code === "auth/weak-password") return { ok: false, error: "Password is too weak (min 6 characters)." };
                return { ok: false, error: e.message };
            }

            const profile = {
                username,
                minecraftUsername,
                contactEmail: email || null,
                currency: 0,
                isAdmin: false,
                createdAt: serverTimestamp()
            };
            await setDoc(doc(dbFirestore, "users", cred.user.uid), profile);
            _cachedProfile = { id: cred.user.uid, ...profile };
            return { ok: true, user: _cachedProfile };
        },

        async signIn({ usernameOrEmail, password }) {
            const username = (usernameOrEmail || "").trim();
            if (!username) return { ok: false, error: "Enter your username." };
            try {
                const cred = await signInWithEmailAndPassword(auth, loginEmailFor(username), password);
                const snap = await getDoc(doc(dbFirestore, "users", cred.user.uid));
                _cachedProfile = snap.exists() ? { id: cred.user.uid, ...snap.data() } : null;
                return { ok: true, user: _cachedProfile };
            } catch (e) {
                if (e.code === "auth/invalid-credential" || e.code === "auth/user-not-found" || e.code === "auth/wrong-password") {
                    return { ok: false, error: "Incorrect username or password." };
                }
                return { ok: false, error: e.message };
            }
        },

        async signOut() {
            await fbSignOut(auth);
            _cachedProfile = null;
            return { ok: true };
        },

        currentUser() {
            return _cachedProfile;
        }
    };

    /* =========================================================
       PRODUCTS  (public read, admin-only write — see firestore.rules)
       ========================================================= */

    const products = {
        async list({ onlyActive = false } = {}) {
            const snap = await getDocs(collection(dbFirestore, "products"));
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return onlyActive ? all.filter(p => p.active) : all;
        },
        async get(id) {
            const snap = await getDoc(doc(dbFirestore, "products", id));
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
        },
        async upsert(product) {
            const data = { ...product };
            delete data.id;
            if (product.id) {
                await updateDoc(doc(dbFirestore, "products", product.id), data);
                return { ok: true, product };
            } else {
                const ref = doc(collection(dbFirestore, "products"));
                data.active = data.active !== false;
                await setDoc(ref, data);
                return { ok: true, product: { ...data, id: ref.id } };
            }
        },
        async remove(id) {
            await deleteDoc(doc(dbFirestore, "products", id));
            return { ok: true };
        }
    };

    /* =========================================================
       CART  (one doc per user, only that user can read/write it)
       ========================================================= */

    const cart = {
        async get(userId) {
            const snap = await getDoc(doc(dbFirestore, "carts", userId));
            return snap.exists() ? (snap.data().items || []) : [];
        },
        async setQty(userId, productId, qty) {
            const ref = doc(dbFirestore, "carts", userId);
            const snap = await getDoc(ref);
            let items = snap.exists() ? (snap.data().items || []) : [];
            if (qty <= 0) {
                items = items.filter(i => i.productId !== productId);
            } else {
                const existing = items.find(i => i.productId === productId);
                if (existing) existing.qty = qty;
                else items.push({ productId, qty });
            }
            await setDoc(ref, { items });
            return items;
        },
        async clear(userId) {
            await setDoc(doc(dbFirestore, "carts", userId), { items: [] });
        }
    };

    /* =========================================================
       ORDERS / CHECKOUT
       ---------------------------------------------------------
       SECURITY NOTE: checkout runs as a Firestore transaction
       that (a) re-reads live prices/stock from Firestore rather
       than trusting the client's cart, and (b) can only ever
       DECREASE a user's own currency — the security rules
       forbid a non-admin from ever increasing their own balance,
       so nobody can grant themselves free FlopCoins this way.

       What this does NOT fully guarantee on its own: that every
       order document was actually paid for (a technically savvy
       user could, in theory, write an order doc directly without
       going through this transaction). The rules require the
       order's total to not exceed their currently stored balance
       at write time, which stops the obvious version of this
       attack, but a fully airtight version of this needs a
       Cloud Function. See README.md "Hardening further" — until
       then, just glance at an order's total vs. the buyer's
       balance in the admin panel before delivering anything.
       ========================================================= */

    const orders = {
        async checkout(userId) {
            try {
                const cartRef = doc(dbFirestore, "carts", userId);
                const userRef = doc(dbFirestore, "users", userId);
                const orderRef = doc(collection(dbFirestore, "orders"));

                const result = await runTransaction(dbFirestore, async (tx) => {
                    const cartSnap = await tx.get(cartRef);
                    const userSnap = await tx.get(userRef);
                    const items = cartSnap.exists() ? (cartSnap.data().items || []) : [];
                    if (items.length === 0) throw new Error("Your cart is empty.");

                    const user = userSnap.data();
                    let total = 0;
                    const lineItems = [];
                    const productRefs = items.map(i => doc(dbFirestore, "products", i.productId));
                    const productSnaps = await Promise.all(productRefs.map(r => tx.get(r)));

                    for (let i = 0; i < items.length; i++) {
                        const pSnap = productSnaps[i];
                        if (!pSnap.exists()) continue;
                        const p = pSnap.data();
                        const qty = items[i].qty;
                        if (typeof p.stock === "number" && p.stock < qty) {
                            throw new Error(`Not enough stock for "${p.name}".`);
                        }
                        total += p.price * qty;
                        lineItems.push({ productId: pSnap.id, name: p.name, price: p.price, qty });
                    }

                    if (user.currency < total) {
                        throw new Error(`Not enough ${CONFIG.currencyName}. You need ${total - user.currency} more.`);
                    }

                    tx.update(userRef, { currency: user.currency - total });
                    productSnaps.forEach((pSnap, i) => {
                        if (pSnap.exists() && typeof pSnap.data().stock === "number") {
                            tx.update(productRefs[i], { stock: pSnap.data().stock - items[i].qty });
                        }
                    });
                    tx.set(orderRef, {
                        userId,
                        username: user.username,
                        minecraftUsername: user.minecraftUsername,
                        items: lineItems,
                        total,
                        status: "pending",
                        createdAt: serverTimestamp()
                    });
                    tx.set(cartRef, { items: [] });

                    return { total, newBalance: user.currency - total };
                });

                if (_cachedProfile) _cachedProfile.currency = result.newBalance;
                return { ok: true, newBalance: result.newBalance };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },

        async listByUser(userId) {
            const q = query(collection(dbFirestore, "orders"), where("userId", "==", userId));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        },

        async listAll() {
            const snap = await getDocs(collection(dbFirestore, "orders"));
            return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        },

        async setStatus(orderId, status) {
            await updateDoc(doc(dbFirestore, "orders", orderId), { status });
            return { ok: true };
        }
    };

    /* =========================================================
       USERS  (admin management — requires isAdmin, see rules)
       ========================================================= */

    const users = {
        async list() {
            const snap = await getDocs(collection(dbFirestore, "users"));
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        },
        async get(userId) {
            const snap = await getDoc(doc(dbFirestore, "users", userId));
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
        },
        async grantCurrency(userId, amount) {
            try {
                await updateDoc(doc(dbFirestore, "users", userId), { currency: increment(amount) });
                const snap = await getDoc(doc(dbFirestore, "users", userId));
                if (_cachedProfile && _cachedProfile.id === userId) _cachedProfile.currency = snap.data().currency;
                return { ok: true, newBalance: snap.data().currency };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },
        async setAdmin(userId, isAdmin) {
            try {
                await updateDoc(doc(dbFirestore, "users", userId), { isAdmin: !!isAdmin });
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }
    };

    /* =========================================================
       REDEEM CODES
       ========================================================= */

    const codes = {
        async create({ code, amount, maxUses }) {
            code = (code || "").trim().toUpperCase();
            if (!code) return { ok: false, error: "Code text is required." };
            const ref = doc(dbFirestore, "codes", code);
            const existing = await getDoc(ref);
            if (existing.exists()) return { ok: false, error: "That code already exists." };
            await setDoc(ref, {
                amount: Number(amount) || 0,
                maxUses: Number(maxUses) || 1,
                usedBy: [],
                createdAt: serverTimestamp()
            });
            return { ok: true };
        },
        async list() {
            const snap = await getDocs(collection(dbFirestore, "codes"));
            return snap.docs.map(d => ({ code: d.id, ...d.data() }));
        },
        async remove(code) {
            await deleteDoc(doc(dbFirestore, "codes", code.trim().toUpperCase()));
            return { ok: true };
        },
        async redeem(userId, codeText) {
            const codeId = (codeText || "").trim().toUpperCase();
            try {
                const result = await runTransaction(dbFirestore, async (tx) => {
                    const codeRef = doc(dbFirestore, "codes", codeId);
                    const userRef = doc(dbFirestore, "users", userId);
                    const codeSnap = await tx.get(codeRef);
                    const userSnap = await tx.get(userRef);
                    if (!codeSnap.exists()) throw new Error("That code doesn't exist.");
                    const code = codeSnap.data();
                    const usedBy = code.usedBy || [];
                    if (usedBy.includes(userId)) throw new Error("You've already used this code.");
                    if (usedBy.length >= code.maxUses) throw new Error("This code has reached its use limit.");

                    const newBalance = (userSnap.data().currency || 0) + code.amount;
                    tx.update(userRef, { currency: newBalance, lastRedemption: { code: codeId, amount: code.amount } });
                    tx.update(codeRef, { usedBy: arrayUnion(userId) });
                    return { amount: code.amount, newBalance };
                });
                if (_cachedProfile) _cachedProfile.currency = result.newBalance;
                return { ok: true, amount: result.amount, newBalance: result.newBalance };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }
    };

    return { auth: authApi, products, cart, orders, users, codes };
})();

window.DB = DB;
export default DB;
