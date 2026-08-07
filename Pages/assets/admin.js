/* =========================================================
   FlopDroid Store — admin panel logic
   ========================================================= */

(() => {
    const $ = sel => document.querySelector(sel);
    const $$ = sel => Array.from(document.querySelectorAll(sel));

    function toast(message, type = "info") {
        const stack = $("#toastStack");
        const el = document.createElement("div");
        el.className = `toast${type === "error" ? " error" : ""}`;
        el.textContent = message;
        stack.appendChild(el);
        setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 250); }, 3200);
    }

    function openModal(id) { $(`#${id}Overlay`).classList.add("open"); }
    function closeAllModals() { $$(".modal-overlay").forEach(m => m.classList.remove("open")); }
    $$("[data-close-modal]").forEach(btn => btn.addEventListener("click", closeAllModals));
    $$(".modal-overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o) closeAllModals(); }));

    /* ---------- access guard ---------- */
    async function checkAccess() {
        const user = DB.auth.currentUser();
        if (!user || !user.isAdmin) {
            $("#guardBox").innerHTML = `
                <p style="color:var(--text-soft);">You need to be signed in on an admin account to see this page.</p>
                <p style="color:var(--text-faint);font-size:0.85rem;">Tip: the very first account ever created on the store becomes admin automatically.</p>
                <a class="btn-primary" style="display:inline-block;margin-top:0.8rem;text-decoration:none;" href="store.html">Go sign in</a>
            `;
            return false;
        }
        $("#guardBox").style.display = "none";
        $("#adminApp").style.display = "block";
        return true;
    }

    /* ---------- tabs ---------- */
    $$(".admin-tab").forEach(tab => tab.addEventListener("click", () => {
        $$(".admin-tab").forEach(t => t.classList.remove("active"));
        $$(".admin-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        $(`#panel-${tab.dataset.tab}`).classList.add("active");
    }));

    /* ---------- products ---------- */
    async function loadProducts() {
        const products = await DB.products.list();
        $("#productsTbody").innerHTML = products.map(p => `
            <tr>
                <td>${p.name}</td>
                <td>${p.category || "—"}</td>
                <td>🪙 ${p.price}</td>
                <td>${typeof p.stock === "number" ? p.stock : "∞"}</td>
                <td>${p.active ? "✅" : "—"}</td>
                <td class="row-actions">
                    <button class="btn-secondary" data-edit="${p.id}">Edit</button>
                    <button class="btn-danger" data-del="${p.id}">Delete</button>
                </td>
            </tr>
        `).join("") || `<tr><td colspan="6" style="color:var(--text-faint);">No products yet.</td></tr>`;

        $$("[data-edit]").forEach(btn => btn.addEventListener("click", async () => {
            const p = await DB.products.get(btn.dataset.edit);
            $("#productModalTitle").textContent = "Edit product";
            $("#pId").value = p.id;
            $("#pName").value = p.name;
            $("#pDesc").value = p.description || "";
            $("#pImage").value = p.image;
            $("#pCategory").value = p.category || "";
            $("#pPrice").value = p.price;
            $("#pStock").value = typeof p.stock === "number" ? p.stock : "";
            $("#pActive").checked = !!p.active;
            openModal("product");
        }));
        $$("[data-del]").forEach(btn => btn.addEventListener("click", async () => {
            if (!confirm("Delete this product? This can't be undone.")) return;
            await DB.products.remove(btn.dataset.del);
            toast("Product deleted.");
            loadProducts();
        }));
    }

    $("#newProductBtn").addEventListener("click", () => {
        $("#productForm").reset();
        $("#pId").value = "";
        $("#productModalTitle").textContent = "New product";
        $("#pActive").checked = true;
        openModal("product");
    });

    $("#productForm").addEventListener("submit", async e => {
        e.preventDefault();
        const stockVal = $("#pStock").value;
        const res = await DB.products.upsert({
            id: $("#pId").value || undefined,
            name: $("#pName").value,
            description: $("#pDesc").value,
            image: $("#pImage").value,
            category: $("#pCategory").value,
            price: Number($("#pPrice").value),
            stock: stockVal === "" ? null : Number(stockVal),
            active: $("#pActive").checked
        });
        if (!res.ok) { toast(res.error, "error"); return; }
        closeAllModals();
        toast("Product saved.");
        loadProducts();
    });

    /* ---------- orders ---------- */
    async function loadOrders() {
        const orders = await DB.orders.listAll();
        $("#ordersTbody").innerHTML = orders.map(o => `
            <tr>
                <td>${new Date(o.createdAt).toLocaleString()}</td>
                <td>${o.username}</td>
                <td>${o.minecraftUsername || "—"}</td>
                <td>${o.items.map(i => `${i.qty}× ${i.name}`).join(", ")}</td>
                <td>🪙 ${o.total}</td>
                <td>
                    <select data-order="${o.id}" class="order-status-select" style="background:var(--bg-soft);color:var(--text);border:1px solid var(--border-strong);border-radius:6px;padding:0.3em 0.5em;">
                        <option value="pending" ${o.status === "pending" ? "selected" : ""}>Pending</option>
                        <option value="delivered" ${o.status === "delivered" ? "selected" : ""}>Delivered</option>
                        <option value="cancelled" ${o.status === "cancelled" ? "selected" : ""}>Cancelled</option>
                    </select>
                </td>
            </tr>
        `).join("") || `<tr><td colspan="6" style="color:var(--text-faint);">No orders yet.</td></tr>`;

        $$(".order-status-select").forEach(sel => sel.addEventListener("change", async () => {
            await DB.orders.setStatus(sel.dataset.order, sel.value);
            toast("Order updated.");
        }));
    }

    /* ---------- users ---------- */
    async function loadUsers() {
        const users = await DB.users.list();
        $("#usersTbody").innerHTML = users.map(u => `
            <tr>
                <td>${u.username}</td>
                <td>${u.minecraftUsername || "—"}</td>
                <td>🪙 <span id="bal-${u.id}">${u.currency}</span></td>
                <td>
                    <input type="checkbox" data-admin="${u.id}" ${u.isAdmin ? "checked" : ""} style="width:auto;">
                </td>
                <td class="row-actions">
                    <input type="number" placeholder="±amount" data-grant-input="${u.id}" style="width:90px;background:var(--bg-soft);color:var(--text);border:1px solid var(--border-strong);border-radius:6px;padding:0.3em 0.5em;">
                    <button class="btn-secondary" data-grant="${u.id}">Apply</button>
                </td>
            </tr>
        `).join("") || `<tr><td colspan="5" style="color:var(--text-faint);">No users yet.</td></tr>`;

        $$("[data-admin]").forEach(cb => cb.addEventListener("change", async () => {
            await DB.users.setAdmin(cb.dataset.admin, cb.checked);
            toast("Admin status updated.");
        }));
        $$("[data-grant]").forEach(btn => btn.addEventListener("click", async () => {
            const input = $(`[data-grant-input="${btn.dataset.grant}"]`);
            const amount = Number(input.value);
            if (!amount) return;
            const res = await DB.users.grantCurrency(btn.dataset.grant, amount);
            if (!res.ok) { toast(res.error, "error"); return; }
            $(`#bal-${btn.dataset.grant}`).textContent = res.newBalance;
            input.value = "";
            toast(`${amount > 0 ? "Granted" : "Removed"} ${Math.abs(amount)} FlopCoins.`);
        }));
    }

    /* ---------- redeem codes ---------- */
    async function loadCodes() {
        const codes = await DB.codes.list();
        $("#codesTbody").innerHTML = codes.map(c => `
            <tr>
                <td>${c.code}</td>
                <td>🪙 ${c.amount}</td>
                <td>${c.usedBy.length} / ${c.maxUses}</td>
                <td><button class="btn-danger" data-del-code="${c.code}">Delete</button></td>
            </tr>
        `).join("") || `<tr><td colspan="4" style="color:var(--text-faint);">No codes yet.</td></tr>`;

        $$("[data-del-code]").forEach(btn => btn.addEventListener("click", async () => {
            await DB.codes.remove(btn.dataset.delCode);
            toast("Code deleted.");
            loadCodes();
        }));
    }

    $("#newCodeBtn").addEventListener("click", () => { $("#codeForm").reset(); openModal("code"); });
    $("#codeForm").addEventListener("submit", async e => {
        e.preventDefault();
        const res = await DB.codes.create({
            code: $("#cCode").value,
            amount: Number($("#cAmount").value),
            maxUses: Number($("#cMaxUses").value)
        });
        if (!res.ok) { toast(res.error, "error"); return; }
        closeAllModals();
        toast("Code created.");
        loadCodes();
    });

    /* ---------- init ---------- */
    (async () => {
        const ok = await checkAccess();
        if (!ok) return;
        await Promise.all([loadProducts(), loadOrders(), loadUsers(), loadCodes()]);
    })();
})();
