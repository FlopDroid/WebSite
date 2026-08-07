/* =========================================================
   FlopDroid Store — page logic
   Reads/writes only through the DB object in db.js.
   ========================================================= */

(() => {
    let currentUser = null;
    let allProducts = [];
    let cartItems = [];
    let activeCategory = "All";

    const $ = sel => document.querySelector(sel);
    const $$ = sel => Array.from(document.querySelectorAll(sel));

    /* ---------- toast helper ---------- */
    function toast(message, type = "info") {
        const stack = $("#toastStack");
        const el = document.createElement("div");
        el.className = `toast${type === "error" ? " error" : ""}`;
        el.textContent = message;
        stack.appendChild(el);
        setTimeout(() => {
            el.classList.add("leaving");
            setTimeout(() => el.remove(), 250);
        }, 3200);
    }

    /* ---------- modal helpers ---------- */
    function openModal(id) { $(`#${id}Overlay`).classList.add("open"); }
    function closeModal(id) { $(`#${id}Overlay`).classList.remove("open"); }
    function closeAllModals() { $$(".modal-overlay").forEach(m => m.classList.remove("open")); }

    $$("[data-close-modal]").forEach(btn => btn.addEventListener("click", closeAllModals));
    $$(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", e => { if (e.target === overlay) closeAllModals(); });
    });
    $$("[data-switch-to]").forEach(link => {
        link.addEventListener("click", () => {
            closeAllModals();
            openModal(link.dataset.switchTo);
        });
    });

    /* ---------- auth / topbar rendering ---------- */
    async function refreshAuthUI() {
        currentUser = DB.auth.currentUser();
        const chip = $("#accountChip");
        const pill = $("#coinPill");
        if (currentUser) {
            chip.textContent = currentUser.username + (currentUser.isAdmin ? " ⚙" : "");
            pill.style.display = "inline-flex";
            $("#coinAmount").textContent = currentUser.currency;
            cartItems = await DB.cart.get(currentUser.id);
        } else {
            chip.textContent = "Sign in";
            pill.style.display = "none";
            cartItems = [];
        }
        renderCartBadge();
    }

    $("#accountChip").addEventListener("click", () => {
        if (currentUser) openAccountModal();
        else openModal("signIn");
    });

    /* ---------- sign up / sign in / sign out ---------- */
    $("#signUpForm").addEventListener("submit", async e => {
        e.preventDefault();
        const btn = e.target.querySelector("button");
        btn.disabled = true;
        const res = await DB.auth.signUp({
            username: $("#suUser").value,
            minecraftUsername: $("#suMc").value,
            email: $("#suEmail").value,
            password: $("#suPass").value
        });
        btn.disabled = false;
        if (!res.ok) { $("#suError").textContent = res.error; return; }
        $("#suError").textContent = "";
        closeAllModals();
        e.target.reset();
        await refreshAuthUI();
        toast(`Welcome, ${res.user.username}!${res.user.isAdmin ? " You are the store admin." : ""}`);
    });

    $("#signInForm").addEventListener("submit", async e => {
        e.preventDefault();
        const btn = e.target.querySelector("button");
        btn.disabled = true;
        const res = await DB.auth.signIn({
            usernameOrEmail: $("#siUser").value,
            password: $("#siPass").value
        });
        btn.disabled = false;
        if (!res.ok) { $("#siError").textContent = res.error; return; }
        $("#siError").textContent = "";
        closeAllModals();
        e.target.reset();
        await refreshAuthUI();
        toast(`Welcome back, ${res.user.username}!`);
    });

    $("#signOutBtn").addEventListener("click", async () => {
        await DB.auth.signOut();
        closeAllModals();
        await refreshAuthUI();
        toast("Signed out.");
    });

    /* ---------- account modal ---------- */
    async function openAccountModal() {
        currentUser = DB.auth.currentUser();
        $("#acctBalance").textContent = currentUser.currency;
        $("#acctUsername").textContent = currentUser.username;
        $("#acctMc").textContent = "MC: " + currentUser.minecraftUsername;
        $("#redeemError").textContent = "";
        $("#redeemInput").value = "";

        const orders = await DB.orders.listByUser(currentUser.id);
        const historyEl = $("#orderHistory");
        if (orders.length === 0) {
            historyEl.innerHTML = `<p style="color:var(--text-faint);font-size:0.85rem;">No orders yet.</p>`;
        } else {
            historyEl.innerHTML = orders.map(o => `
                <div class="order-item">
                    <div class="order-head">
                        <span>${new Date(o.createdAt).toLocaleDateString()}</span>
                        <span class="status-badge ${o.status}">${o.status}</span>
                    </div>
                    <div style="font-size:0.85rem;">
                        ${o.items.map(i => `${i.qty}× ${i.name}`).join(", ")}
                    </div>
                    <div style="font-size:0.8rem;color:var(--text-faint);margin-top:0.3rem;">Total: 🪙 ${o.total}</div>
                </div>
            `).join("");
        }
        openModal("account");
    }

    $("#redeemBtn").addEventListener("click", async () => {
        const code = $("#redeemInput").value;
        if (!code) return;
        const res = await DB.codes.redeem(currentUser.id, code);
        if (!res.ok) { $("#redeemError").textContent = res.error; return; }
        $("#redeemError").textContent = "";
        toast(`+${res.amount} 🪙 redeemed!`);
        await refreshAuthUI();
        bumpCoinPill();
        openAccountModal();
    });

    function bumpCoinPill() {
        const pill = $("#coinPill");
        pill.classList.remove("bump");
        void pill.offsetWidth; // restart animation
        pill.classList.add("bump");
    }

    /* ---------- products ---------- */
    async function loadProducts() {
        allProducts = await DB.products.list({ onlyActive: true });
        renderFilters();
        renderProducts();
    }

    function renderFilters() {
        const cats = ["All", ...new Set(allProducts.map(p => p.category).filter(Boolean))];
        $("#filterRow").innerHTML = cats.map(c =>
            `<button class="filter-chip${c === activeCategory ? " active" : ""}" data-cat="${c}">${c}</button>`
        ).join("");
        $$(".filter-chip").forEach(btn => btn.addEventListener("click", () => {
            activeCategory = btn.dataset.cat;
            renderFilters();
            renderProducts();
        }));
    }

    function renderProducts() {
        const grid = $("#productGrid");
        const list = activeCategory === "All" ? allProducts : allProducts.filter(p => p.category === activeCategory);
        if (list.length === 0) {
            grid.innerHTML = `<p style="color:var(--text-faint);">Nothing here yet — check back soon.</p>`;
            return;
        }
        grid.innerHTML = list.map(p => {
            const outOfStock = typeof p.stock === "number" && p.stock <= 0;
            return `
            <div class="product-card">
                <div class="item-slot">
                    <img src="${p.image}" alt="${p.name}">
                    ${typeof p.stock === "number" ? `<span class="stock-tag${outOfStock ? " out" : ""}">${outOfStock ? "Sold out" : p.stock + " left"}</span>` : ""}
                </div>
                <span class="category-label">${p.category || ""}</span>
                <h4>${p.name}</h4>
                <p class="desc">${p.description || ""}</p>
                <div class="card-footer">
                    <span class="price-tag">🪙 ${p.price}</span>
                    <button class="btn-primary" data-add="${p.id}" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Sold out" : "Add to cart"}</button>
                </div>
            </div>`;
        }).join("");

        $$("[data-add]").forEach(btn => btn.addEventListener("click", () => addToCart(btn.dataset.add)));
    }

    async function addToCart(productId) {
        if (!currentUser) { openModal("signIn"); toast("Sign in to add items to your cart."); return; }
        const existing = cartItems.find(i => i.productId === productId);
        cartItems = await DB.cart.setQty(currentUser.id, productId, (existing ? existing.qty : 0) + 1);
        renderCartBadge();
        toast("Added to cart.");
    }

    /* ---------- cart drawer ---------- */
    function renderCartBadge() {
        const count = cartItems.reduce((sum, i) => sum + i.qty, 0);
        const badge = $("#cartBadge");
        badge.textContent = count;
        badge.classList.toggle("show", count > 0);
    }

    function openCart() {
        renderCartDrawer();
        $("#drawerOverlay").classList.add("open");
        $("#cartDrawer").classList.add("open");
    }
    function closeCart() {
        $("#drawerOverlay").classList.remove("open");
        $("#cartDrawer").classList.remove("open");
    }
    $("#cartBtn").addEventListener("click", openCart);
    $("#closeCart").addEventListener("click", closeCart);
    $("#drawerOverlay").addEventListener("click", closeCart);

    function renderCartDrawer() {
        const wrap = $("#cartItems");
        if (cartItems.length === 0) {
            wrap.innerHTML = `<div class="cart-empty">Your cart is empty.</div>`;
            $("#cartTotal").textContent = "🪙 0";
            return;
        }
        let total = 0;
        wrap.innerHTML = cartItems.map(item => {
            const p = allProducts.find(p => p.id === item.productId);
            if (!p) return "";
            total += p.price * item.qty;
            return `
            <div class="cart-row">
                <div class="item-slot"><img src="${p.image}" alt="${p.name}"></div>
                <div class="cart-row-info">
                    <p>${p.name}</p>
                    <span>🪙 ${p.price} each</span>
                </div>
                <div class="qty-control">
                    <button data-qty="-1" data-id="${p.id}">−</button>
                    <span>${item.qty}</span>
                    <button data-qty="1" data-id="${p.id}">+</button>
                </div>
            </div>`;
        }).join("");
        $("#cartTotal").textContent = `🪙 ${total}`;

        $$("[data-qty]").forEach(btn => btn.addEventListener("click", async () => {
            const item = cartItems.find(i => i.productId === btn.dataset.id);
            const delta = Number(btn.dataset.qty);
            cartItems = await DB.cart.setQty(currentUser.id, btn.dataset.id, item.qty + delta);
            renderCartDrawer();
            renderCartBadge();
        }));
    }

    $("#checkoutBtn").addEventListener("click", async () => {
        if (!currentUser) { closeCart(); openModal("signIn"); return; }
        const btn = $("#checkoutBtn");
        btn.disabled = true;
        const res = await DB.orders.checkout(currentUser.id);
        btn.disabled = false;
        if (!res.ok) { toast(res.error, "error"); return; }
        toast("Order placed! We'll deliver it in-game shortly.");
        cartItems = [];
        currentUser.currency = res.newBalance;
        $("#coinAmount").textContent = res.newBalance;
        bumpCoinPill();
        renderCartBadge();
        renderCartDrawer();
        renderProducts(); // reflect any stock changes
        closeCart();
    });

    /* ---------- init ---------- */
    (async () => {
        await refreshAuthUI();
        await loadProducts();
    })();
})();
