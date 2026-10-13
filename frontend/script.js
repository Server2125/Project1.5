const API_BASE = "http://127.0.0.1:8000";

async function loadAllData() {
    const endpoints = {
        connection: '/api/connection',
        imp: '/api/import',
        exp: '/api/export',
        prom: '/api/production',
        procurement: '/api/procurement',
        registry: '/api/registry',
        stavka: '/api/stavka'
    };

    for (const [key, path] of Object.entries(endpoints)) {
        try {
            const res = await fetch(API_BASE + path);
            const json = await res.json();
            DATA[key] = Array.isArray(json) ? json : [];
            console.log(`✅ ${key}: ${DATA[key].length}`);
        } catch (err) {
            console.error(`❌ ${key}:`, err);
        }
    }

    console.log('✅ Данные загружены');
    document.getElementById("lastRefreshLabel").textContent =
        "Обновлено: " + new Date().toLocaleString("ru-RU");
}

document.getElementById("refreshBtn").addEventListener("click", loadAllData);

document.querySelectorAll(".currency-switch button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".currency-switch button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        displayCurrency = btn.dataset.currency;
    });
});

let displayCurrency = "UZS";

loadAllData();

// ===== ПРИОРИТЕТНЫЕ ТОВАРЫ =====

let topProducts = [];
let topVisibleCount = 10;

function esc(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function usd(v) {
    if (!v) return "0";
    return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ") + " сум";
}

function pct(v) {
    if (v === null || v === undefined) return "—";
    return (v * 100).toFixed(1) + "%";
}

function recommendationShort(p) {
    const score = p.priorityScore || 0;
    if (score >= 70) return { cls: "green", short: "Поддерживать" };
    if (score >= 40) return { cls: "orange", short: "Локализация" };
    return { cls: "red", short: "Создать производство" };
}

function buildTopProducts() {
    if (!DATA.procurement || !DATA.procurement.length) return;

    const grouped = new Map();

    for (const r of DATA.procurement) {
        const code = String(r.good_code || r.tnved_code || "").replace(".0", "").trim();
        if (!code) continue;

        const name = r.good_name || r.good_category || "Без названия";
        const price = Number(r.total_price) || 0;
        const qty = Number(r.quantity) || 0;

        let g = grouped.get(code);
        if (!g) {
            g = {
                code: code,
                name: name,
                total: 0,
                industrial: 0,
                outside: 0,
                count: 0,
                qty: 0,
                market: 0,
                exportUSD: 0,
                prodUSD: 0,
                id: null,
                priorityScore: 0
            };
            grouped.set(code, g);
        }

        g.total += price;
        g.qty += qty;
        g.count += 1;
    }

    topProducts = [...grouped.values()].map(p => {
        p.market = p.total * 1.2;
        p.exportUSD = p.total * 0.1;
        p.prodUSD = p.total * 0.3;
        p.id = 0.5 + Math.random() * 0.5;
        p.priorityScore = Math.round(p.id * 100);
        return p;
    }).sort((a, b) => b.priorityScore - a.priorityScore);

        renderTopProducts();
         updateStatsCards();   // ← ДОБАВИТЬ
}

function renderTopProducts() {
    const host = document.getElementById("topProductsBody");
    const footer = document.getElementById("topProductsFooter");
    if (!host) return;

    if (!topProducts.length) {
        host.innerHTML = `<div class="small" style="padding:14px">Загрузка...</div>`;
        return;
    }

    const shown = topProducts.slice(0, topVisibleCount);

    host.innerHTML = shown.map((p, i) => {
        const rr = recommendationShort(p);
        const potential = Math.round(p.priorityScore || 0);
        const potentialPct = Math.min(potential, 100);

        return `
        <div class="top-table-row" data-top-code="${p.code}">
            <div class="num">${i + 1}</div>
            <div class="name-cell">
                <div class="name">${esc(p.name)}</div>
                <div class="code">ТН ВЭД: ${p.code}</div>
            </div>
            <div>
                <div class="potential-pct">${potentialPct}%</div>
                <div class="potential-bar">
                    <div class="potential-bar-fill" style="width:${potentialPct}%"></div>
                </div>
            </div>
            <div class="num">${usd(p.market)}</div>
            <div class="num">${pct(p.id)}</div>
            <div class="num">${usd(p.exportUSD)}</div>
            <div class="num">${usd(p.prodUSD)}</div>
            <div class="num">${Math.round(p.priorityScore || 0)}</div>
            <div><span class="compact-badge ${rr.cls}">${rr.short}</span></div>
        </div>`;
    }).join('');

    if (footer) {
        footer.classList.remove("hidden");
        document.getElementById("topCountInfo").textContent =
            `Показано ${shown.length} из ${topProducts.length}`;
        document.getElementById("showMoreTop").classList.toggle("hidden",
            shown.length >= topProducts.length);
    }
}

document.getElementById("showMoreTop")?.addEventListener("click", () => {
    topVisibleCount += 10;
    renderTopProducts();
});

// Ждём загрузки данных
let checkData = setInterval(() => {
    if (DATA.procurement && DATA.procurement.length > 0) {
        clearInterval(checkData);
        buildTopProducts();
        console.log("📊 Приоритетные товары построены:", topProducts.length);
    }
}, 500);

