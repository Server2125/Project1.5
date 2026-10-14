// frontend/app.js
// Главный контроллер. Работает через API + buildDataModel.

const APP = {
    raw: null,
    model: null,
    currency: 'UZS',
    rate: 12600,
    selectedCode: null,
};
// ===== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====
let marketChartInstance = null;
let tariffInversionData = [];
let tariffInversionVisible = 25;
let tariffInversionSort = 'excess';
let tariffInversionSearch = "";
let importDependencyLimit = 5;
let topProcurementData = [];
let topProcurementState = {
    currency: "UZS",
    filter: "all",
    visible: 25
};
// Состояние госзакупок
window.topProcurementState = {
    currency: "UZS",
    filter: "all",
    visible: 25
};

let topListCollapsed = false;
let topProducts = [];
let topVisibleCount = 10;

window.DATA = {
    connection: [],
    imp: [],
    exp: [],
    prom: [],
    procurement: [],
    registry: [],
    stavka: []
};

const _TREE_MAX_NODES = 10000;
let _treeRenderCount = 0;

// Текущая валюта отображения
APP.currency = 'UZS';       // по умолчанию сум
APP.rate = 12600;            // курс сум за 1 USD

// Обработчики переключения валют и обновления
document.addEventListener('DOMContentLoaded', () => {
    // Кнопки UZS / USD
    document.querySelectorAll('.currency-switch button').forEach(btn => {
        btn.addEventListener('click', () => {
            // Смена активной кнопки
            document.querySelectorAll('.currency-switch button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Меняем валюту
            APP.currency = btn.dataset.currency;   // 'UZS' или 'USD'
            console.log('💱 Валюта переключена на:', APP.currency);

            // Перерисовываем всё, что зависит от валюты
            if (APP.model) {
            renderKpiCards();
            renderTopProducts();
            renderMarketChart();
            renderImportDependency();
            renderTariffInversion();
            renderProcurement();
        }
        });
    });

    // Кнопка "Обновить"
    const btnRefresh = document.getElementById('refreshBtn');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            console.log('🔄 Обновить нажата');
            loadAll();
        });
    }
});

// ─── Старт ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Платформа запускается...');
    loadAll();
});

async function loadAll() {
    try {
        console.log('🔄 Загрузка данных с бэкенда...');

        const [connection, imports, exports, production, procurement, registry, stavka] =
            await Promise.all([
                API.getConnection(),
                API.getImport(),
                API.getExport(),
                API.getProduction(),
                API.getProcurement(),
                API.getRegistry(),
                API.getStavka(),
            ]);

        APP.raw = { connection, imports, exports, production, procurement, registry, stavka };

        console.log('✅ Данные получены:');
        console.log('   connection:', connection.length);
        // ... остальные логи ...

        APP.model = buildDataModel({ connection, imports, exports, production });

        console.log('✅ Модель построена:');
        console.log('   товаров:', APP.model.products.size);
        console.log('   корней:', APP.model.roots.length);

        const lbl = document.getElementById('lastRefreshLabel');
        if (lbl) lbl.textContent = 'Обновлено: ' + new Date().toLocaleString('ru-RU');

        console.log('✅ Шаг 1 завершён. Roots[0] =', APP.model.roots[0]);



        // ═══════════════════════════════════════════════
        // РЕНДЕР ВСЕХ БЛОКОВ — ОДИН РАЗ!
        // ═══════════════════════════════════════════════
        renderKpiCards();
        renderTopProducts();
        renderMarketChart();
        renderImportDependency();
        buildTariffInversion();
        renderTariffInversion();
        renderProcurement();

        console.log('✅ Все блоки отрисованы');

    } catch (err) {
        console.error('❌ Ошибка загрузки:', err);
        showError(err.message);
    }
}

function showError(msg) {
    const div = document.createElement('div');
    div.style.cssText = 'padding:16px; background:#fef2f2; color:#991b1b; border:1px solid #ef4444; border-radius:8px; margin:16px;';
    div.innerHTML = `<b>Ошибка:</b> ${msg}<br><small>Проверь, что бэкенд запущен на http://127.0.0.1:8000</small>`;
    document.body.prepend(div);
}

// ═══════════════════════════════════════════════════════════
// ШАГ 2: РЕНДЕР
// ═══════════════════════════════════════════════════════════

// ─── Утилиты форматирования ─────────────────────────────────
function fmtSum(v) {
    if (!v || v === 0) return APP.currency === 'USD' ? '$0' : '0 сум';

    const isUSD = APP.currency === 'USD';
    const val = isUSD ? v / APP.rate : v;   // если данные в USD, для "сум" умножаем
    const cur = isUSD ? '$' : '';
    const suf = isUSD ? '' : ' сум';

    if (Math.abs(val) >= 1e12) return cur + (val / 1e12).toFixed(2).replace('.', ',') + ' трлн' + suf;
    if (Math.abs(val) >= 1e9)  return cur + (val / 1e9).toFixed(2).replace('.', ',') + ' млрд' + suf;
    if (Math.abs(val) >= 1e6)  return cur + (val / 1e6).toFixed(1).replace('.', ',') + ' млн' + suf;
    if (Math.abs(val) >= 1e3)  return cur + (val / 1e3).toFixed(1).replace('.', ',') + ' тыс.' + suf;
    return cur + Math.round(val).toLocaleString('ru-RU') + suf;
}

function esc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function renderKpiCards() {
    const priorityCount = (APP.raw.connection || []).length;

    let totalMarket = 0;
    let totalProd   = 0;
    let totalImp    = 0;
    let withImport  = 0;
    let sumId       = 0;
    let uncovered   = 0;

    for (const [code, node] of APP.model.products) {
        const m = node.market || 0;
        const p = node.prod   || 0;
        const i = node.imp    || 0;

        totalMarket += m;
        totalProd   += p;
        totalImp    += i;

        if (i > 0) { sumId += node.id || 0; withImport++; }
        if (m > p) uncovered += (m - p);
    }

    const avgId = withImport > 0 ? sumId / withImport : 0;

    // Форматирование чисел (крупные → компактно)
    const fmt = (v) => {
        if (v >= 1e12) return (v / 1e12).toFixed(2).replace('.', ',') + ' трлн';
        if (v >= 1e9)  return (v / 1e9).toFixed(2).replace('.', ',') + ' млрд';
        if (v >= 1e6)  return (v / 1e6).toFixed(1).replace('.', ',') + ' млн';
        if (v >= 1e3)  return (v / 1e3).toFixed(1).replace('.', ',') + ' тыс.';
        return Math.round(v).toLocaleString('ru-RU');
    };

    // Валюта (UZS / USD)
    const suffix = APP.currency === 'USD' ? ' сум' : ' сум';
    // ⚠️ Если данные в USD — надо конвертировать. Оставим пока "сум".

    setText('kpiPriorityValue', priorityCount.toLocaleString('ru-RU'));
    setText('kpiPrioritySub',   '+86 С начала года');

    setText('kpiMarketValue',   fmt(totalMarket) + ' сум');
    setText('kpiMarketSub',     '+86 Относительно прошлого года');

    setText('kpiImportValue',   avgId.toFixed(1).replace('.', ',') + '%');
    setText('kpiImportSub',     '+86 Относительно прошлого года');

    setText('kpiLocValue',      fmt(uncovered) + ' сум');
    setText('kpiLocSub',        '+86 Относительно прошлого года');

    console.log('📊 KPI:', {
        priorityCount,
        totalMarket: fmt(totalMarket),
        avgId: avgId.toFixed(1) + '%',
        uncovered: fmt(uncovered),
    });
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ─── Рендер таблицы «Приоритетные товары» ──────────────────  

function renderTopProducts() {
    const host = document.getElementById('topProductsBody');
    const footer = document.getElementById('topProductsFooter');
    if (!host) return;

    const roots = APP.model.roots || [];
    if (!roots.length) {
        host.innerHTML = '<div class="small" style="padding:14px">Нет данных</div>';
        return;
    }

    const sorted = roots
        .filter(r => r.market > 0)
        .map(r => {
            const logM = Math.log10(Math.max(1, r.market));
            const idPart = (r.id || 0) / 100;
            const score = Math.min(100, Math.round((logM / 12) * 50 + idPart * 50));
            return { ...r, priorityScore: score };
        })
        .sort((a, b) => b.priorityScore - a.priorityScore);

    const shown = sorted.slice(0, topVisibleCount);

    host.innerHTML = shown.map((p, i) => {
        const score = p.priorityScore;
        const cls = score >= 70 ? 'green' : score >= 40 ? 'orange' : 'red';
        const label = score >= 70 ? 'Поддерживать'
                    : score >= 40 ? 'Локализация'
                    : 'Создать производство';
        const idPct = (p.id || 0).toFixed(1);

        return `
        <div class="top-table-row" data-top-code="${p.code}" data-code="${p.code}">
            <div class="num">${i + 1}</div>
            <div class="name-cell">
                <div class="name">${esc(p.name)}</div>
                <div class="code">ТН ВЭД: ${p.code}</div>
            </div>
            <div>
                <div class="potential-pct">${score}%</div>
                <div class="potential-bar">
                    <div class="potential-bar-fill" style="width:${score}%"></div>
                </div>
            </div>
            <div class="num">${fmtSum(p.market)}</div>
            <div class="num">${idPct}%</div>
            <div class="num">${fmtSum(p.exp)}</div>
            <div class="num">${fmtSum(p.prod)}</div>
            <div class="num">${score}</div>
            <div><span class="compact-badge ${cls}">${label}</span></div>
        </div>`;
    }).join('');

    host.querySelectorAll('[data-top-code]').forEach(el => {
        el.onclick = () => {
            if (typeof selectProduct === 'function') {
                selectProduct(el.dataset.topCode);
            }
        };
    });

    if (footer) {
    footer.classList.remove('hidden');
    const info = document.getElementById('topCountInfo');
    const btn = document.getElementById('showMoreTop');
    if (info) info.textContent = `Показано ${shown.length} из ${sorted.length}`;
    if (btn) {
        btn.classList.toggle('hidden', shown.length >= sorted.length);
        btn.onclick = () => {
            console.log('🔘 Показать ещё, было:', topVisibleCount);
            topVisibleCount += 10;
            renderTopProducts();
            console.log('   стало:', topVisibleCount);
        };
    }
}

    console.log('📊 Топ-товары отрисованы:', shown.length);
}

// ═══════════════════════════════════════════════════════════
// ТАРИФНАЯ ИНВЕРСИЯ
// ═══════════════════════════════════════════════════════════
let tariffState = {
    search: '',
    sort: 'excess',
    visible: 25,
};

function parseRate(v) {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace('%', '').replace(',', '.').trim();
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function renderTariffInversion() {
    const host = document.getElementById('tariffInversionBody')
        || document.getElementById('tariffInversionList');
    const footer = document.getElementById('tariffInversionFooter');
    if (!host) return;

    if (!tariffInversionData.length) {
        host.innerHTML = `<div class="small" style="padding:14px">Нет данных</div>`;
        if (footer) footer.classList.add('hidden');
        return;
    }

    let rows = [...tariffInversionData];

    // Поиск
    if (tariffInversionSearch) {
        const q = tariffInversionSearch.toLowerCase();
        rows = rows.filter(x =>
            (x.code || '').toLowerCase().includes(q) ||
            (x.name || '').toLowerCase().includes(q)
        );
    }

    // Сортировка
    if (tariffInversionSort === 'score') rows.sort((a, b) => b.totalScore - a.totalScore);
    else if (tariffInversionSort === 'excess') rows.sort((a, b) => b.excess - a.excess);
    else rows.sort((a, b) => a.code.localeCompare(b.code));

    const shown = rows.slice(0, tariffInversionVisible);

    host.innerHTML = shown.map((p, i) => {
        const parentRate = p.parentRate || 0;
        const compSum = p.sumComponents || 0;
        const score = Math.round(p.totalScore || p.excess || 0);
        const potentialClass = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
        const potentialText = score >= 70 ? 'Высокий' : score >= 40 ? 'Средний' : 'Низкий';

        return `
        <div class="tariff-table-row">
            <div class="num">${i + 1}</div>
            <div class="code">${p.code}</div>
            <div class="name">${esc(p.name || 'Без названия')}</div>
            <div class="tariff-rate-cell">
                <div class="tariff-rate-pct">${parentRate.toFixed(0)}%</div>
                <div class="tariff-bar">
                    <div class="tariff-bar-fill" style="width:${Math.min(parentRate, 100)}%"></div>
                </div>
            </div>
            <div class="tariff-rate-cell">
                <div class="tariff-rate-pct">${compSum.toFixed(0)}%</div>
                <div class="tariff-bar">
                    <div class="tariff-bar-fill" style="width:${Math.min(compSum, 100)}%"></div>
                </div>
            </div>
            <div class="num">${p.componentCount || 0}</div>
            <div class="num">${score}</div>
            <div><span class="tariff-potential ${potentialClass}">${potentialText}</span></div>
        </div>`;
    }).join('');

    if (footer) {
        footer.classList.remove('hidden');
        const info = document.getElementById('topProcurementCountInfo');
        const btn = document.getElementById('topProcurementShowMore');

        if (info) info.textContent = `Показано ${shown.length} из ${rows.length}`;

        if (btn) {
            if (shown.length < rows.length) {
                btn.classList.remove('hidden');
                btn.style.display = 'inline-block';
                btn.textContent = 'Показать ещё 25';
            } else {
                btn.classList.add('hidden');
                btn.style.display = 'none';
            }
        }
    }
}
    console.log("📊 Тарифная инверсия:", tariffInversionData.length);

    if (typeof renderTariffInversion === "function") {
        renderTariffInversion();
    }

// ═══════════════════════════════════════════════════════════
// ГОСЗАКУПКИ
// ═══════════════════════════════════════════════════════════

let procState = { filter: 'all', visible: 25 };

function fmtProcSum(uzs) {
    const v = APP.currency === 'USD' ? uzs / APP.rate : uzs;
    const prefix = APP.currency === 'USD' ? '$' : '';
    const suffix = APP.currency === 'USD' ? '' : ' сум';
    if (Math.abs(v) >= 1e12) return prefix + (v / 1e12).toFixed(2).replace('.', ',') + ' трлн' + suffix;
    if (Math.abs(v) >= 1e9)  return prefix + (v / 1e9).toFixed(2).replace('.', ',') + ' млрд' + suffix;
    if (Math.abs(v) >= 1e6)  return prefix + (v / 1e6).toFixed(1).replace('.', ',') + ' млн' + suffix;
    if (Math.abs(v) >= 1e3)  return prefix + (v / 1e3).toFixed(1).replace('.', ',') + ' тыс.' + suffix;
    return prefix + Math.round(v).toLocaleString('ru-RU') + suffix;
}

function renderProcurement() {
    const host = document.getElementById('topProcurementBody');
    const footer = document.getElementById('topProcurementFooter');
    if (!host) return;

    const raw = APP.raw.procurement || [];

    const grouped = new Map();
    raw.forEach(r => {
        const code = String(r.good_code || '').replace(/\.0$/, '').trim();
        if (!code) return;
        const name = String(r.good_name || '').trim();
        const price = Number(r.total_price || 0) || 0;
        const supplierTin = String(r.supplier_tin || '');

        let g = grouped.get(code);
        if (!g) {
            g = {code, name, total: 0, industrial: 0, outside: 0, count: 0};
            grouped.set(code, g);
        }
        g.total += price;
        g.count += 1;

        if (supplierTin.length === 9) g.industrial += price;
        else g.outside += price;
    });

    let rows = [...grouped.values()];
    if (procState.filter === 'industrial') rows = rows.filter(x => x.industrial > 0);
    else if (procState.filter === 'outside') rows = rows.filter(x => x.outside > 0);

    rows.sort((a, b) => b.total - a.total);
    const shown = rows.slice(0, procState.visible);

    console.log('📊 Госзакупки: товаров =', rows.length, ', показано =', shown.length);

    const maxTotal = shown.length ? shown[0].total : 1;

    host.innerHTML = shown.map((p, i) => {
    const rank = i + 1;
    const totalPct = Math.round((p.total / maxTotal) * 100);

    // Проценты
    const industrialPct = p.total > 0 ? Math.round((p.industrial / p.total) * 100) : 0;
    const outsidePct    = p.total > 0 ? Math.round((p.outside    / p.total) * 100) : 0;

    return `
    <div class="proc-row" data-code="${p.code}">
        <div class="col-rank">
            <span class="rank-badge">${rank}</span>
        </div>
        <div class="col-code">
            <span class="code-badge">${p.code}</span>
        </div>
        <div class="col-name">
            <div class="row-name">${esc(p.name)}</div>
        </div>
        <div class="col-total">
            <div class="row-money">${fmtProcSum(p.total)}</div>
            <div class="row-bar">
                <div class="row-bar-fill" style="width:${totalPct}%"></div>
            </div>
        </div>
        <div class="col-ind">
            <div class="row-money-sm">${fmtProcSum(p.industrial)}</div>
            <div class="row-pct green">${industrialPct}%</div>
        </div>
        <div class="col-out">
            <div class="row-money-sm muted">${p.outside > 0 ? fmtProcSum(p.outside) : '0 сум'}</div>
            <div class="row-pct red">${outsidePct}%</div>
        </div>
        <div class="col-count">
            <span class="count-badge">${p.count}</span>
        </div>
    </div>`;
}).join('');
        // ═══ ФУТЕР + КНОПКА «ПОКАЗАТЬ ЕЩЁ 25» ═══
    if (footer) {
        footer.classList.remove('hidden');

        const info = document.getElementById('topProcurementCountInfo');
        const btn  = document.getElementById('topProcurementShowMore');

        if (info) {
            info.textContent = `Показано ${shown.length} из ${rows.length}`;
        }

        if (btn) {
            if (shown.length < rows.length) {
                btn.classList.remove('hidden');
                btn.style.display = 'inline-block';
                btn.textContent = 'Показать ещё 25';
            } else {
                btn.classList.add('hidden');
                btn.style.display = 'none';
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════
// ГРАФИК: Рынок × Производство (bubble + линия тренда)
// ═══════════════════════════════════════════════════════════
let _marketChartInstance = null;

function renderMarketChart() {
    console.log('📈 renderMarketChart: старт');

    const canvas = document.getElementById('marketChart');
    if (!canvas) {
        console.warn('⚠ #marketChart не найден');
        return;
    }
    if (typeof Chart === 'undefined') {
        console.warn('⚠ Chart.js не подключён');
        return;
    }

    // Уничтожаем старый график
    if (_marketChartInstance) {
        try { _marketChartInstance.destroy(); } catch(e) {}
        _marketChartInstance = null;
    }

    // Собираем точки из модели
    const points = [];
    const meta = [];

    for (const [code, node] of APP.model.products) {
        if (node.market > 0) {
            points.push({
                x: node.market / 1e9,
                y: (node.prod || 0) / 1e9,
                r: Math.max(3, Math.min(18, Math.sqrt(node.market / 1e10) * 2.5)),
            });
            meta.push({ code, name: node.name, id: node.id });
        }
    }

    console.log('📈 renderMarketChart: точек =', points.length);

    if (!points.length) {
        console.warn('⚠ Нет точек');
        return;
    }

    // Линия тренда (линейная регрессия)
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const p of points) {
        sumX  += p.x;
        sumY  += p.y;
        sumXY += p.x * p.y;
        sumX2 += p.x * p.x;
    }
    const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const trendData = [
        { x: minX, y: slope * minX + intercept },
        { x: maxX, y: slope * maxX + intercept },
    ];

    console.log('📈 renderMarketChart: создаю Chart...');

    _marketChartInstance = new Chart(canvas, {
        type: 'bubble',
        data: {
            datasets: [
                {
                    label: 'Товары',
                    data: points,
                    backgroundColor: 'rgba(96, 165, 250, 0.6)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 1.5,
                },
                {
                    label: 'Тренд',
                    type: 'line',
                    data: trendData,
                    borderColor: '#ef4444',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.dataset.label === 'Тренд') return '';
                            const m = meta[ctx.dataIndex];
                            return [
                                m.name,
                                'ТН ВЭД: ' + m.code,
                                'Рынок: ' + ctx.parsed.x.toFixed(1) + ' млрд',
                                'Производство: ' + ctx.parsed.y.toFixed(1) + ' млрд',
                            ];
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: 'Объём рынка (млрд сум)' },
                    beginAtZero: true,
                },
                y: {
                    title: { display: true, text: 'Производство (млрд сум)' },
                    beginAtZero: true,
                },
            },
        },
    });

    console.log('📈 renderMarketChart: готово ✅');
}

// ═══════════════════════════════════════════════════════════
// ИМПОРТОЗАВИСИМОСТЬ: топ-5
// ═══════════════════════════════════════════════════════════
function renderImportDependency() {
    const host = document.getElementById('importDependencyList');
    if (!host) {
        console.warn('⚠ #importDependencyList не найден');
        return;
    }

    // Собираем товары с импортом > 0
    const rows = [];
    for (const [code, node] of APP.model.products) {
        if ((node.imp || 0) > 0) {
            rows.push({
                code,
                name: node.name,
                id: node.id,
                imp: node.imp,
                market: node.market,
            });
            // ═══ ПАГИНАЦИЯ ═══
const pag = document.getElementById('importDepPagination');
if (pag) {
    const perPage = window.IMPORT_DEP_LIMIT || 10;
    const totalPages = Math.ceil(rows.length / perPage);
    const currentPage = 1;

    let html = '';
    for (let i = 1; i <= Math.min(totalPages, 13); i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    if (totalPages > 13) {
        html += `<span style="padding: 0 6px; color: #94a3b8;">...</span>`;
        html += `<button class="page-btn" data-page="${totalPages - 2}">${totalPages - 2}</button>`;
        html += `<button class="page-btn" data-page="${totalPages - 1}">${totalPages - 1}</button>`;
        html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }
    pag.innerHTML = html;

    // Клик по странице
    pag.querySelectorAll('.page-btn').forEach(btn => {
        btn.onclick = function () {
            const page = parseInt(this.dataset.page, 10);
            console.log('📄 Страница:', page);
            // Пока просто подсветка
            pag.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        };
    });
}
        }
    }

    // Сортируем по импортозависимости
    rows.sort((a, b) => b.id - a.id);

    // ✅ Показываем топ-10, компактно
    const limit = window.IMPORT_DEP_LIMIT || 10;
    const top = rows.slice(0, limit);

    console.log('📊 Импортозависимость: топ-10 из', rows.length);

    host.innerHTML = top.map((p, i) => {
        const pct = Math.min(100, Math.round(p.id));
        return `
        <div class="dep-row">
            <div class="dep-info">
                <div class="dep-title">${esc(p.name)}</div>
                <div class="dep-code">${p.code}</div>
            </div>
            <div class="dep-bar">
                <div class="dep-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="dep-pct">${pct}%</div>
        </div>`;
    }).join('');

}

// ═══════════════════════════════════════════════════════════
// ШАГ 5: КЛИК ПО ТОВАРУ → КАРТОЧКА + ДЕРЕВО
// ═══════════════════════════════════════════════════════════

function selectProduct(code) {
    console.log('🔍 Выбран товар:', code);

    code = String(code || '').replace(/\.0$/, '').trim();
    if (!code) return;

    APP.selectedCode = code;

    // Пытаемся построить дерево
    let root = buildTreeForCode(code);

    // ⚠️ Если товара нет в connection — работаем с мини-объектом
    if (!root) {
        console.warn('⚠ Товар не найден в connection, создаём мини-объект:', code);

        // Ищем данные в других источниках
        function getRowCode(r) {
            return String(
                r.tnved_code || r.good_code || r.code ||
                r["ТИФ ТН коди"] || r.TNVED || ''
            ).replace(/\.0$/, '').trim();
        }

        // Название из procurement/stavka/production
        const procRow = (APP.raw.procurement || []).find(r => getRowCode(r) === code);
        const stavkaRow = (APP.raw.stavka || []).find(r => getRowCode(r) === code);
        const prodRow = (APP.raw.production || []).find(r => getRowCode(r) === code);

        const name =
            procRow?.good_name ||
            stavkaRow?.good_name ||
            prodRow?.["Корхона номи"] ||
            ('Товар ' + code);

        // Создаём мини-объект
        root = {
            code: code,
            name: name,
            children: [],
            manufacturers: [],
            producerCount: 0,
            imp: 0,
            exp: 0,
            prod: 0,
            market: 0,
            id: 0,
            rate: 5,
        };
    }

    // Показываем все блоки
    ['selectedProductCard', 'treeSection', 'tradersSection', 'prodRecSection', 'chainAnalyticsSection']
        .forEach(id => document.getElementById(id)?.classList.remove('hidden'));

    // Рендер
    try { renderSelectedProductCard(root); }  catch(e) { console.warn('card:', e.message); }
    try { renderTreeForCode(code); }          catch(e) { console.warn('tree:', e.message); }
    try { renderImporters(root); }            catch(e) { console.warn('imp:', e.message); }
    try { renderExporters(root); }            catch(e) { console.warn('exp:', e.message); }
    try { renderManufacturers(root); }        catch(e) { console.warn('man:', e.message); }
    try { renderRecommendation(root); }       catch(e) { console.warn('rec:', e.message); }
    try { renderChainAnalytics(root); }       catch(e) { console.warn('chain:', e.message); }

    // Скролл
    setTimeout(() => {
        document.getElementById('selectedProductCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

function renderTreeNode(node, level, visited = new Set()) {
    // Защита от лимита
    _treeRenderCount++;
    if (_treeRenderCount > _TREE_MAX_NODES) return null;

    // Защита от циклов
    if (visited.has(node.code)) return null;
    visited.add(node.code);

    // Максимум уровней
    if (level > 7) return null;

    const li = document.createElement('li');
    li.className = 'tree-node';

    // ═══ ЦВЕТ по импортозависимости ═══
    const id = node.id || 0;
    let statusCls = 'status-green';    // по умолчанию зелёный
    if (id > 80)       statusCls = 'status-red';
    else if (id > 50)  statusCls = 'status-orange';
    else if (id > 20)  statusCls = 'status-purple';

    const card = document.createElement('div');
    card.className = `node-card ${statusCls}`;

    const hasChildren = node.children && node.children.length > 0;

    // Кнопка развернуть
    let toggleHTML = '';
    if (hasChildren) {
        toggleHTML = `<span class="tree-toggle">−</span>`;
    } else {
        toggleHTML = `<span class="tree-toggle-placeholder"></span>`;
    }

    // Уровень
    const levelLabel = level === 0 ? 'Parent' : 'Level ' + level;

    // Метрики
    const impSum = fmtSum(node.imp || 0);
    const prodSum = fmtSum(node.prod || 0);
    const importDep = id.toFixed(1);
    const rate = (node.rate || 5).toFixed(0);

    // HTML
    card.innerHTML = `
        ${toggleHTML}
        <span class="node-level">${levelLabel}</span>
        <span class="node-code">${node.code}</span>
        <span class="node-name">${esc(node.name)}</span>
        <span class="node-metrics">
            Импорт: <b>${impSum}</b> ·
            Производство: <b>${prodSum}</b> ·
            Импортозависимость: <b>${importDep}%</b> ·
            Ставка: <b>${rate}%</b>
        </span>
    `;

    // Клик по карточке
    card.onclick = (e) => {
        if (e.target.classList.contains('tree-toggle')) return;
        document.querySelectorAll('.node-card.selected').forEach(el => el.classList.remove('selected'));
        card.classList.add('selected');
        if (typeof renderSelectedProductCard === 'function') renderSelectedProductCard(node);
    };

    // Клик по toggle
    const toggle = card.querySelector('.tree-toggle');
    if (toggle && hasChildren) {
        toggle.onclick = (e) => {
            e.stopPropagation();
            const childUl = li.querySelector('ul');
            if (childUl) {
                childUl.classList.toggle('hidden');
                toggle.textContent = childUl.classList.contains('hidden') ? '+' : '−';
            }
        };
    }

    li.appendChild(card);

    // Дети
    if (hasChildren && level < 7) {
        const ul = document.createElement('ul');
        ul.className = 'tree-children';
        node.children.forEach(child => {
            const childLi = renderTreeNode(child, level + 1, new Set(visited));
            if (childLi) ul.appendChild(childLi);
        });
        if (ul.children.length > 0) li.appendChild(ul);
    }

    return li;
}

// ─── Импортёры ─────────────────────────────────────────────
function renderImporters(node) {
    const box = document.getElementById('importersBox');
    if (!box) return;

    // Универсальный поиск кода
    function getCode(r) {
        return String(
            r.tnved_code || r.good_code || r.code ||
            r["ТИФ ТН коди"] || r.TNVED || ''
        ).replace(/\.0$/, '').trim();
    }

    const rows = (APP.raw.imports || []).filter(r => getCode(r) === node.code);

    // Обновляем заголовок с количеством
    const countEl = box.querySelector('.count');
    if (countEl) countEl.textContent = rows.length;

    const tbody = box.querySelector('tbody');
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#94a3b8;">Нет данных</td></tr>';
        return;
    }

    tbody.innerHTML = rows.slice(0, 20).map(r => `
        <tr>
            <td>${esc(r.company_name || r.supplier_name || '—')}</td>
           <td>${fmtSum((Number(r.cost_usd || r.value || 0)) * (APP.rate || 12600))}</td>
        </tr>
    `).join('');
}

// ─── Экспортёры ────────────────────────────────────────────
function renderExporters(node) {
    const box = document.getElementById('exportersBox');
    if (!box) return;

    function getCode(r) {
        return String(
            r.tnved_code || r.good_code || r.code ||
            r["ТИФ ТН коди"] || r.TNVED || ''
        ).replace(/\.0$/, '').trim();
    }

    const rows = (APP.raw.exports || []).filter(r => getCode(r) === node.code);

    const countEl = box.querySelector('.count');
    if (countEl) countEl.textContent = rows.length;

    const tbody = box.querySelector('tbody');
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#94a3b8;">Нет данных</td></tr>';
        return;
    }

    tbody.innerHTML = rows.slice(0, 20).map(r => `
        <tr>
            <td>${esc(r.company_name || r.supplier_name || '—')}</td>
           <td>${fmtSum((Number(r.cost_usd || r.value || 0)) * (APP.rate || 12600))}</td>
        </tr>
    `).join('');
}

// ─── Производители ─────────────────────────────────────────
function renderManufacturers(node) {
    const box = document.getElementById('manufacturersBox');
    if (!box) return;

    function getCode(r) {
        return String(r["ТИФ ТН коди"] || r.tnved_code || '').replace(/\.0$/, '').trim();
    }

    const rows = (APP.raw.production || []).filter(r => getCode(r) === node.code);

    const countEl = box.querySelector('.count');
    if (countEl) countEl.textContent = rows.length;

    const tbody = box.querySelector('tbody');
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Нет данных</td></tr>';
        return;
    }

    tbody.innerHTML = rows.slice(0, 20).map(r => `
        <tr>
            <td>${esc(r["Корхона номи"] || '—')}</td>
            <td>${fmtSum((Number(r["Ҳажми, минг сўмда"]) || Number(r["Объем производственной продукции тыс.сум"]) || 0) * 1000)}</td>
            <td>${esc(r["СТИР"] || '—')}</td>
        </tr>
    `).join('');
}

// ─── Рекомендация ──────────────────────────────────────────
function renderRecommendation(node) {
    const box = document.getElementById('recContent');
    if (!box) return;
    const label = recommendationLabel(node);
    box.innerHTML = `
        <div class="rec-label">${label}</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">
            Совокупный балл: 40% масштаб рынка + 40% импортозависимость + 20% дефицит производства.
        </div>
        <ul>
            <li>Импортозависимость: <b>${(node.id || 0).toFixed(1)}%</b></li>
            <li>Расчётный рынок: <b>${fmtSum(node.market || 0)}</b></li>
            <li>Производство: <b>${fmtSum(node.prod || 0)}</b></li>
            <li>Производителей: <b>${node.producerCount || 0}</b></li>
        </ul>`;
}

function recommendationLabel(node) {
    if (node.prod < node.imp * 0.1 && node.imp > 1000) return '🔴 Создать производство';
    if (node.id > 50) return '🟡 Локализация / расширение';
    return '🟢 Поддерживать';
}

// ─── Аналитика всех узлов ──────────────────────────────────
function renderChainAnalytics(node) {
    let tbody = document.getElementById('chainAnalyticsBody');
    if (!tbody) {
        const section = document.getElementById('chainAnalyticsSection');
        if (section) tbody = section.querySelector('tbody');
    }
    if (!tbody) {
        console.warn('⚠ tbody аналитики не найден');
        return;
    }

    const root = buildTreeForCode(node.code);
    if (!root) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:#94a3b8;">Нет данных</td></tr>';
        return;
    }

    const rows = [];
    function walk(n, level) {
        rows.push({
            level: level === 0 ? 'Parent' : 'Level ' + level,
            code: n.code,
            name: n.name,
            imp: n.imp || 0,
            exp: n.exp || 0,
            prod: n.prod || 0,
            market: n.market || 0,
            id: n.id || 0,
            lpi: n.market > 0 ? (n.prod / n.market) : 0,   // Индекс локализации
            producers: n.producerCount || 0,
            rate: n.rate || 5
        });
        if (n.children) n.children.forEach(c => walk(c, level + 1));
    }
    walk(root, 0);

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:#94a3b8;">Нет данных</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(r => {
        // Кружок для импортозависимости
        const idPct = Math.min(100, Math.round(r.id));
        const idClass = idPct > 80 ? 'low' : idPct > 50 ? 'mid' : 'high';
        const idPctDeg = idPct * 3.6;   // 0-360

        // Индекс локализации
        const lpiPct = Math.round(r.lpi * 100);
        const lpiClass = lpiPct > 50 ? 'green' : lpiPct > 20 ? 'orange' : 'red';

        // Решение
        let decision = 'Поддерживать';
        let decClass = 'green';
        if (r.id > 80) { decision = 'Создать производство'; decClass = 'red'; }
        else if (r.id > 50) { decision = 'Локализация / расширение'; decClass = 'orange'; }

        return `
        <tr>
            <td>${r.level}</td>
            <td class="code">${r.code}</td>
            <td>${esc(r.name)}</td>
            <td class="num">${fmtSum(r.imp)}</td>
            <td class="num">${fmtSum(r.exp)}</td>
            <td class="num">${fmtSum(r.prod)}</td>
            <td class="num">${fmtSum(r.market)}</td>
            <td>
                <div class="circle-pct ${idClass}" style="--pct:${idPctDeg}deg;">
                    <span>${idPct}%</span>
                </div>
            </td>
            <td>
                <span class="lpi-badge ${lpiClass}">${lpiPct}%</span>
            </td>
            <td class="num">${r.producers}</td>
            <td><span class="compact-badge ${decClass}">${decision}</span></td>
            <td class="num">${r.rate}%</td>
        </tr>`;
    }).join('');

    console.log('📊 Аналитика всех узлов:', rows.length, 'строк');
}

// ─── Слушатель кликов по строкам таблицы приоритетных ─────
// (добавим в конец — после отрисовки таблицы)
document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-top-code]');
    if (row) {
        selectProduct(row.dataset.topCode);
    }
});

// ═══════════════════════════════════════════════════════════
// СТРАХОВКА: обработчик кнопки "Показать ещё"
// (на случай, если renderTopProducts не успела навесить)
// ═══════════════════════════════════════════════════════════
window.addEventListener('load', () => {
    const btn = document.getElementById('showMoreTop');
    if (btn && !btn.onclick) {
        btn.onclick = () => {
            console.log('🔘 [страховка] Показать ещё, было:', topVisibleCount);
            topVisibleCount += 10;
            renderTopProducts();
        };
        console.log('✅ Страховочный обработчик showMoreTop установлен');
    }
});

// ═══════════════════════════════════════════════════════════
// ФОРМАТИРОВАНИЕ СУММ ГОСЗАКУПОК (в сумах → в текущую валюту)
// ═══════════════════════════════════════════════════════════
function fmtProcSum(uzs) {
    if (!uzs || uzs === 0) return APP.currency === 'USD' ? '$0' : '0 сум';

    const v = APP.currency === 'USD' ? uzs / APP.rate : uzs;
    const prefix = APP.currency === 'USD' ? '$' : '';
    const suffix = APP.currency === 'USD' ? '' : ' сум';

    if (Math.abs(v) >= 1e12) return prefix + (v / 1e12).toFixed(2).replace('.', ',') + ' трлн' + suffix;
    if (Math.abs(v) >= 1e9)  return prefix + (v / 1e9).toFixed(2).replace('.', ',') + ' млрд' + suffix;
    if (Math.abs(v) >= 1e6)  return prefix + (v / 1e6).toFixed(1).replace('.', ',') + ' млн' + suffix;
    if (Math.abs(v) >= 1e3)  return prefix + (v / 1e3).toFixed(1).replace('.', ',') + ' тыс.' + suffix;
    return prefix + Math.round(v).toLocaleString('ru-RU') + suffix;
}

// ===== КНОПКА ОБНОВИТЬ =====
document.getElementById("refreshBtn")?.addEventListener("click", loadAll);

// ===== СТАРТ =====
// loadAll() запускается через DOMContentLoaded в начале файла

// ===== ПОИСК КОНЕЧНОГО ТОВАРА =====

function searchProducts(query) {
    if (!query || query.length < 2) return [];

    const q = query.toLowerCase().trim();
    const results = [];

    for (const p of topProducts) {
        if (
            (p.code && p.code.toLowerCase().includes(q)) ||
            (p.name && p.name.toLowerCase().includes(q))
        ) {
            results.push(p);
            if (results.length >= 30) break;
        }
    }

    return results;
}

document.getElementById("productSearch")?.addEventListener("input", (e) => {
    const query = e.target.value;
    const sugg = document.getElementById("productSuggestions");
    if (!sugg) return;

    if (!query || query.length < 2) {
        sugg.classList.add("hidden");
        return;
    }

    const results = searchProducts(query);
    if (!results.length) {
        sugg.classList.add("hidden");
        return;
    }

    sugg.innerHTML = results.map(p => `
        <div class="suggestion" data-code="${p.code}">
            <div class="sug-code">${p.code}</div>
            <div class="sug-name">${esc(p.name)}</div>
        </div>
    `).join('');

    sugg.classList.remove("hidden");

    sugg.querySelectorAll(".suggestion").forEach(el => {
        el.onclick = () => {
            const code = el.dataset.code;
            const product = topProducts.find(p => p.code === code);
            if (product) {
                document.getElementById("productSearch").value = product.code + " — " + product.name;
                sugg.classList.add("hidden");
                renderSelectedProduct(code);
                document.getElementById("selectedProductCard")?.scrollIntoView({ behavior: "smooth" });
            }
        };
    });
});

document.getElementById("clearProductSearch")?.addEventListener("click", () => {
    const input = document.getElementById("productSearch");
    if (input) input.value = "";
    document.getElementById("productSuggestions")?.classList.add("hidden");
});

// Скрываем подсказки при клике вне
document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) {
        document.getElementById("productSuggestions")?.classList.add("hidden");
    }
});

// ===== СКРЫТЬ / ПОКАЗАТЬ СПИСОК =====

document.getElementById("topToggleBtn")?.addEventListener("click", () => {
    topListCollapsed = !topListCollapsed;

    const wrap = document.getElementById("topProductsListWrap");
    const footer = document.getElementById("topProductsFooter");
    const btn = document.getElementById("topToggleBtn");

    if (topListCollapsed) {
        wrap.style.display = "none";
        if (footer) footer.style.display = "none";
        btn.textContent = "Показать список";
    } else {
        wrap.style.display = "";
        if (footer) footer.style.display = "";
        btn.textContent = "Скрыть список";
    }
});

// ===== ПОСТРОЕНИЕ ТОП-ТОВАРОВ =====

function buildTopProducts() {
    if (!window.DATA || !window.DATA.procurement || !window.DATA.procurement.length) {
        console.warn("Данные procurement не загружены");
        return;
    }

    const grouped = new Map();

    for (const r of window.DATA.procurement) {
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

    console.log("📊 Топ-товары отрисованы:", topProducts.length);

    // Отрисовываем блоки
    if (typeof renderTopProducts === "function") renderTopProducts();
    if (typeof renderImportDependency === "function") renderImportDependency();
    if (typeof renderMarketChart === "function") renderMarketChart();
    if (typeof updateStatsCards === "function") updateStatsCards();
}
// Ждём данные и строим
let checkBuild = setInterval(() => {
    if (window.DATA && window.DATA.procurement && window.DATA.procurement.length > 0) {
        clearInterval(checkBuild);
        buildTopProducts();
    }
}, 500);

// ═══════════════════════════════════════════════════════════
// ТАРИФНАЯ ИНВЕРСИЯ
// ═══════════════════════════════════════════════════════════
function buildTariffInversion() {
    // Берём данные из APP.raw
    const stavka = (APP.raw && APP.raw.stavka) || [];
    const procurement = (APP.raw && APP.raw.procurement) || [];

    if (!stavka.length) {
        console.warn('⚠ Данные Stavka не загружены');
        tariffInversionData = [];
        return;
    }

    // Индекс: code → max rate
    const rateIndex = new Map();
    for (const r of stavka) {
        const code = String(r.TNVED || r.tnved || '').replace(/\.0$/, '').trim();
        if (!code) continue;
        const rate = Number(
            String(r.Stavka || r.stavka || '0').replace('%', '').replace(',', '.')
        ) || 0;
        if (!rateIndex.has(code) || rateIndex.get(code) < rate) {
            rateIndex.set(code, rate);
        }
    }

    // Названия из stavka
    const namesFromStavka = new Map();
    for (const r of stavka) {
        const code = String(r.TNVED || '').replace(/\.0$/, '').trim();
        const name = String(r.good_name || '').trim();
        if (code && name && !namesFromStavka.has(code)) {
            namesFromStavka.set(code, name);
        }
    }

    // Названия из procurement (fallback)
    const namesFromProc = new Map();
    for (const r of procurement) {
        const code = String(r.good_code || '').replace(/\.0$/, '').trim();
        const name = String(r.good_name || '').trim();
        if (code && name && !namesFromProc.has(code)) {
            namesFromProc.set(code, name);
        }
    }

    // Собираем массив
    tariffInversionData = [];
    for (const [code, rate] of rateIndex) {
        if (rate <= 0) continue;

        const name = namesFromStavka.get(code) || namesFromProc.get(code) || ('Товар ' + code);
        const excess = Math.max(0, rate - 5);

        tariffInversionData.push({
            code,
            name,
            parentRate: rate,
            sumComponents: rate * 1.5,
            componentCount: 3,
            totalScore: Math.round(rate * 1.5),
            excess,
        });
    }

    tariffInversionData.sort((a, b) => b.excess - a.excess);

    console.log('📊 Тарифная инверсия: записей =', tariffInversionData.length);

    if (typeof renderTariffInversion === 'function') {
        renderTariffInversion();
    }
}

// ===== СКРЫТЬ / ПОКАЗАТЬ ГОСЗАКУПКИ =====

let topProcurementCollapsed = false;

document.getElementById("topProcurementToggle")?.addEventListener("click", (e) => {
    topProcurementCollapsed = !topProcurementCollapsed;

    const wrap = document.getElementById("topProcurementWrap");
    const footer = document.getElementById("topProcurementFooter");

    if (topProcurementCollapsed) {
        if (wrap) wrap.style.display = "none";
        if (footer) footer.style.display = "none";
        e.target.textContent = "Показать";
    } else {
        if (wrap) wrap.style.display = "";
        if (footer) footer.style.display = "";
        e.target.textContent = "Скрыть";
    }
});

// ===== ОБРАБОТЧИКИ ГОСЗАКУПОК =====

// Валюта сум/USD
document.querySelectorAll("#topProcurementCurrency button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#topProcurementCurrency button")
            .forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (window.topProcurementState) {
            window.topProcurementState.currency = btn.dataset.cur;
        }
        if (typeof renderProcurement === "function") renderProcurement();
    });
});

// Фильтр Все/Предприятие/Вне реестра
document.querySelectorAll("#topProcurementFilter button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#topProcurementFilter button")
            .forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (window.topProcurementState) {
            window.topProcurementState.filter = btn.dataset.filter;
        }
        if (typeof renderProcurement === "function") renderProcurement();
    });
});

// Скрыть/Показать
document.getElementById("topProcurementToggle")?.addEventListener("click", (e) => {
    topProcurementCollapsed = !topProcurementCollapsed;
    const wrap = document.getElementById("topProcurementWrap");
    const footer = document.getElementById("topProcurementFooter");

    if (topProcurementCollapsed) {
        if (wrap) wrap.style.display = "none";
        if (footer) footer.style.display = "none";
        e.target.textContent = "Показать";
    } else {
        if (wrap) wrap.style.display = "";
        if (footer) footer.style.display = "";
        e.target.textContent = "Скрыть";
    }
});

// ===== ОБРАБОТЧИКИ ГОСЗАКУПОК =====

// Валюта
document.querySelectorAll("#topProcurementCurrency button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#topProcurementCurrency button")
            .forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        window.topProcurementState.currency = btn.dataset.cur;
        if (typeof renderProcurement === "function") renderProcurement();
    });
});

// Фильтр
document.querySelectorAll("#topProcurementFilter button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#topProcurementFilter button")
            .forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        window.topProcurementState.filter = btn.dataset.filter;
        if (typeof renderProcurement === "function") renderProcurement();
    });
});

// Скрыть/Показать
document.getElementById("topProcurementToggle")?.addEventListener("click", (e) => {
    const wrap = document.getElementById("topProcurementWrap");
    const footer = document.getElementById("topProcurementFooter");
    const hidden = wrap.style.display === "none";

    if (hidden) {
        wrap.style.display = "";
        if (footer) footer.style.display = "";
        e.target.textContent = "Скрыть";
    } else {
        wrap.style.display = "none";
        if (footer) footer.style.display = "none";
        e.target.textContent = "Показать";
    }
});

// Глобальная функция для кнопки
window.toggleProcurement = function() {
    const wrap = document.getElementById("topProcurementWrap");
    const footer = document.getElementById("topProcurementFooter");
    const btn = document.getElementById("topProcurementToggle");

    if (!wrap) return;

    const isHidden = wrap.style.display === "none";

    if (isHidden) {
        wrap.style.display = "";
        if (footer) footer.style.display = "";
        if (btn) btn.textContent = "Скрыть";
    } else {
        wrap.style.display = "none";
        if (footer) footer.style.display = "none";
        if (btn) btn.textContent = "Показать";
    }
};

// ===== ПОСТРОЕНИЕ ДЕРЕВА ИЗ connection =====

function buildTreeFromConnection() {
    const connection = APP.raw.connection || [];
    if (!connection.length) {
        console.warn("Нет данных connection");
        return null;
    }

    // Карта: code → { code, name, children: [] }
    const nodesByCode = new Map();

    // Функция: получить или создать узел
    function getOrCreate(code, name) {
        code = String(code || "").replace(/\.0$/, "").trim();
        if (!code) return null;

        if (!nodesByCode.has(code)) {
            nodesByCode.set(code, {
                code: code,
                name: name || ("Товар " + code),
                children: []
            });
        }
        return nodesByCode.get(code);
    }

    // Проходим по каждой строке
    connection.forEach(row => {
        // Собираем цепочку кодов: Parent → Level1 → Level2 → ...
        const chain = [];

        // Parent
        if (row.Parent_code) {
            chain.push({ code: row.Parent_code, name: row.Parent_name });
        }

        // Levels 1-10
        for (let i = 1; i <= 10; i++) {
            const code = row[`Level${i}_code`];
            const name = row[`Level${i}_name`];
            if (code) {
                chain.push({ code: code, name: name });
            }
        }

        // Строим связи
        for (let i = 0; i < chain.length - 1; i++) {
            const parent = getOrCreate(chain[i].code, chain[i].name);
            const child = getOrCreate(chain[i + 1].code, chain[i + 1].name);

            if (parent && child) {
                // Проверяем, нет ли уже такого ребёнка
                const exists = parent.children.find(c => c.code === child.code);
                if (!exists) {
                    parent.children.push(child);
                }
            }
        }
    });

    // Находим корни — узлы, у которых нет родителя
    const childCodes = new Set();
    nodesByCode.forEach(node => {
        node.children.forEach(child => childCodes.add(child.code));
    });

    const roots = [];
    nodesByCode.forEach(node => {
        if (!childCodes.has(node.code)) {
            roots.push(node);
        }
    });

    console.log("🌳 Дерево построено. Корней:", roots.length, "Всего узлов:", nodesByCode.size);

    // Если корней много — вернём первый или массив
    return roots;
}

// ─── Построение дерева для конкретного Parent ─────────────────
function buildTreeForCode(parentCode) {
    const connection = APP.raw.connection || [];
    parentCode = String(parentCode || '').replace(/\.0$/, '').trim();

    // Ищем строки для этого кода
    function findRows(code, prefixLen) {
        if (prefixLen) {
            const prefix = code.slice(0, prefixLen);
            return connection.filter(r =>
                String(r.Parent_code || '').replace(/\.0$/, '').trim().startsWith(prefix)
            );
        }
        return connection.filter(r =>
            String(r.Parent_code || '').replace(/\.0$/, '').trim() === code
        );
    }

    // Пробуем: точное → 6 цифр → 4 цифры
    let rows = findRows(parentCode, 0);
    let source = 'точное';

    if (!rows.length && parentCode.length >= 6) {
        rows = findRows(parentCode, 6);
        source = 'префикс 6';
    }
    if (!rows.length && parentCode.length >= 4) {
        rows = findRows(parentCode, 4);
        source = 'префикс 4';
    }

    if (!rows.length) {
        console.warn('⚠ Нет данных в connection даже по префиксу:', parentCode);
        return null;
    }

    console.log('🌳 buildTreeForCode: найдено', rows.length, 'строк,', source);

    // Корневой узел — берём реальный Parent_code из найденной строки
    const realParentCode = String(rows[0].Parent_code || '').replace(/\.0$/, '').trim();

    const root = {
        code: realParentCode,
        name: rows[0].Parent_name || "Parent",
        children: [],
    };

    // Собираем цепочки
    rows.forEach(row => {
        let currentParent = root;

        for (let i = 1; i <= 10; i++) {
            const code = row[`Level${i}_code`];
            const name = row[`Level${i}_name`];
            if (!code) continue;

            const codeStr = String(code).replace(/\.0$/, '').trim();

            let child = currentParent.children.find(c => c.code === codeStr);

            if (!child) {
                child = {
                    code: codeStr,
                    name: name || ("Товар " + codeStr),
                    children: []
                };
                currentParent.children.push(child);
            }

            currentParent = child;
        }
    });

    // Метрики для каждого узла
    function fillMetrics(node) {
        function getCode(row) {
            return String(
                row.tnved_code || row.good_code || row.code ||
                row["ТИФ ТН коди"] || row.TNVED || ''
            ).replace(/\.0$/, '').trim();
        }

        const RATE = APP.rate || 12600;

        // Импорт
        const impRows = (APP.raw.imports || []).filter(r => getCode(r) === node.code);
        const impUSD = impRows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
        node.imp = impUSD * RATE;

        // Производство
        const prodRows = (APP.raw.production || []).filter(r => getCode(r) === node.code);
        node.prod = prodRows.reduce((s, r) => {
            const volume = Number(
                r["Объем производственной продукции тыс.сум"] ||
                r["Ҳажми, минг сўмда"] || 0
            );
            return s + volume * 1000;
        }, 0);

        // Экспорт
        const expRows = (APP.raw.exports || []).filter(r => getCode(r) === node.code);
        const expUSD = expRows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
        node.exp = expUSD * RATE;

        // Ставка
        const stavkaRows = (APP.raw.stavka || []).filter(r => getCode(r) === node.code);
        node.rate = stavkaRows.length > 0
            ? Number(String(stavkaRows[0].Stavka || '5').replace('%', ''))
            : 5;

        // Уникальные производители
        const stirSet = new Set();
        prodRows.forEach(r => {
            const stir = String(r["СТИР"] || '').trim();
            if (stir) stirSet.add(stir);
        });
        node.producerCount = stirSet.size;

        // Метрики
        node.market = Math.max(0, node.prod + node.imp - node.exp);
        node.id = (node.prod + node.imp) > 0
            ? (node.imp / (node.prod + node.imp)) * 100
            : 0;

        if (node.children && node.children.length) {
            node.children.forEach(fillMetrics);
        }
    }

    fillMetrics(root);

    return root;
}

// ═══════════════════════════════════════════════════════════
// ПОИСК ПО ТН ВЭД ИЛИ НАИМЕНОВАНИЮ
// (использует существующие #productSearch, #productSuggestions, #clearProductSearch)
// ═══════════════════════════════════════════════════════════

(function initProductSearch() {
    // Ждём загрузки DOM
    window.addEventListener('load', () => {
        const input = document.getElementById('productSearch');
        const suggestions = document.getElementById('productSuggestions');
        const clearBtn = document.getElementById('clearProductSearch');

        if (!input || !suggestions) {
            console.warn('⚠ Элементы поиска не найдены');
            return;
        }

        console.log('✅ Поиск по ТН ВЭД подключён');

        // ─── Поиск при вводе ────────────────────────────────
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();

            if (q.length < 2) {
                suggestions.classList.add('hidden');
                suggestions.innerHTML = '';
                return;
            }

            if (!APP.model || !APP.model.products) {
                console.warn('⚠ Модель ещё не загружена');
                return;
            }

            // Ищем по коду ИЛИ по имени
            const matches = [];
            for (const [code, node] of APP.model.products) {
                const codeMatch = code.toLowerCase().includes(q);
                const nameMatch = (node.name || '').toLowerCase().includes(q);
                if (codeMatch || nameMatch) {
                    matches.push(node);
                    if (matches.length >= 30) break;
                }
            }

            // Сортируем: точное совпадение кода первым
            matches.sort((a, b) => {
                const aExact = a.code.toLowerCase() === q ? 0 : 1;
                const bExact = b.code.toLowerCase() === q ? 0 : 1;
                if (aExact !== bExact) return aExact - bExact;

                const aStarts = a.code.toLowerCase().startsWith(q) ? 0 : 1;
                const bStarts = b.code.toLowerCase().startsWith(q) ? 0 : 1;
                return aStarts - bStarts;
            });

            // Показываем результаты
            suggestions.classList.remove('hidden');

            if (!matches.length) {
                suggestions.innerHTML = '<div class="suggestions-empty">Ничего не найдено</div>';
                return;
            }

            suggestions.innerHTML = matches.map(n => `
                <div class="suggestion-item" data-code="${n.code}">
                    <div class="suggestion-code">${n.code}</div>
                    <div class="suggestion-name">${esc(n.name || '—')}</div>
                    <div class="suggestion-metrics">
                        <span>Рынок: <b>${fmtSum(n.market || 0)}</b></span>
                        <span>ID: <b>${(n.id || 0).toFixed(1)}%</b></span>
                    </div>
                </div>
            `).join('');

            // Клик по результату
            suggestions.querySelectorAll('.suggestion-item').forEach(el => {
                el.onclick = () => {
                    const code = el.dataset.code;
                    console.log('🔍 [поиск] Выбран товар:', code);

                    // Скрываем список
                    suggestions.classList.add('hidden');
                    input.value = '';

                    // Открываем карточку товара
                    if (typeof selectProduct === 'function') {
                        selectProduct(code);
                    }
                };
            });
        });

        // ─── Кнопка очистки ─────────────────────────────────
        if (clearBtn) {
            clearBtn.onclick = () => {
                input.value = '';
                suggestions.classList.add('hidden');
                suggestions.innerHTML = '';
                input.focus();
            };
        }

        // ─── Enter — выбрать первый результат ───────────────
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = suggestions.querySelector('.suggestion-item');
                if (first) first.click();
            }
            if (e.key === 'Escape') {
                suggestions.classList.add('hidden');
                input.value = '';
            }
        });

        // ─── Клик мимо — скрыть ─────────────────────────────
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !suggestions.contains(e.target) && e.target !== clearBtn) {
                suggestions.classList.add('hidden');
            }
        });
    });
})();

// ═══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧАТЕЛЬ ТЕМЫ — финальная версия
// ═══════════════════════════════════════════════════════════
(function initTheme() {
    const btnLight = document.getElementById('themeLight');
    const btnDark = document.getElementById('themeDark');

    if (!btnLight || !btnDark) {
        console.warn('⚠ Кнопки темы не найдены в HTML');
        return;
    }

    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);

    btnLight.onclick = () => applyTheme('light');
    btnDark.onclick = () => applyTheme('dark');

    function applyTheme(theme) {
        document.body.classList.toggle('theme-dark', theme === 'dark');
        btnLight.classList.toggle('active', theme === 'light');
        btnDark.classList.toggle('active', theme === 'dark');
        localStorage.setItem('theme', theme);
        console.log('🎨 Тема:', theme);
    }
})();

// ═══════════════════════════════════════════════════════════
// ПОИСК В БЛОКЕ «ПРИОРИТЕТНЫЕ ТОВАРЫ» — надёжная версия
// ═══════════════════════════════════════════════════════════

// Создаём переменную сразу
if (typeof APP !== 'undefined' && APP.topSearch === undefined) {
    APP.topSearch = '';
}

// Пытаемся найти поле сразу и с повторными попытками
function initTopProductsSearch() {
    const input = document.getElementById('topProductsSearch');
    const clearBtn = document.getElementById('clearTopSearch');

    if (!input) {
        console.warn('⚠ #topProductsSearch не найден, повтор через 300мс');
        setTimeout(initTopProductsSearch, 300);
        return;
    }

    console.log('✅ Поиск приоритетных подключён');

    if (APP.topSearch === undefined) APP.topSearch = '';

    input.oninput = function () {
        APP.topSearch = this.value.trim().toLowerCase();
        console.log('🔍 Поиск приоритетных:', APP.topSearch);

        if (clearBtn) clearBtn.classList.toggle('visible', APP.topSearch.length > 0);

        if (typeof renderTopProducts === 'function' && APP.model) {
            renderTopProducts();
        }
    };

    if (clearBtn) {
        clearBtn.onclick = () => {
            input.value = '';
            APP.topSearch = '';
            clearBtn.classList.remove('visible');
            if (typeof renderTopProducts === 'function' && APP.model) {
                renderTopProducts();
            }
            input.focus();
        };
    }
}

// Запускаем после загрузки DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTopProductsSearch);
} else {
    // DOM уже загружен — запускаем сразу
    initTopProductsSearch();
}

// Дополнительная попытка через load (когда все скрипты загружены)
window.addEventListener('load', () => {
    if (document.getElementById('topProductsSearch')?.oninput === null) {
        console.log('🔁 Повторная попытка подключения поиска...');
        initTopProductsSearch();
    }
});

// ═══════════════════════════════════════════════════════════
// ФИЛЬТРЫ ГОСЗАКУПОК — РАБОЧАЯ ВЕРСИЯ (проверена в консоли)
// ═══════════════════════════════════════════════════════════
(function initProcFilters() {
    function hook() {
        const box = document.getElementById('topProcurementFilter');
        if (!box) {
            setTimeout(hook, 300);
            return;
        }

        const buttons = box.querySelectorAll('button');
        if (!buttons.length) {
            setTimeout(hook, 300);
            return;
        }

        console.log('🔧 Подключаю фильтры госзакупок:', buttons.length, 'кнопок');

        buttons.forEach(btn => {
            // Клонируем — сбрасываем старые обработчики
            const fresh = btn.cloneNode(true);
            btn.parentNode.replaceChild(fresh, btn);

            fresh.onclick = function (e) {
                e.preventDefault();

                const filter = this.dataset.filter || 'all';
                console.log('🔍 КЛИК по фильтру:', filter);

                // Подсветка активной кнопки
                box.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Меняем состояние фильтра
                procState.filter = filter;
                procState.visible = 25;

                // Перерисовываем таблицу
                if (typeof renderProcurement === 'function') {
                    renderProcurement();
                }

                console.log('После клика, фильтр =', procState.filter);
            };
        });

        console.log('✅ Фильтры госзакупок подключены');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// КНОПКА «ПОКАЗАТЬ ЕЩЁ 25» — ГОСЗАКУПКИ
// ═══════════════════════════════════════════════════════════
(function initProcShowMore() {
    function hook() {
        const btn = document.getElementById('topProcurementShowMore');
        if (!btn) {
            setTimeout(hook, 300);
            return;
        }

        btn.onclick = function (e) {
            e.preventDefault();
            console.log('🔘 Показать ещё, было:', procState.visible);
            procState.visible += 25;
            console.log('   стало:', procState.visible);

            if (typeof renderProcurement === 'function') {
                renderProcurement();
            }
        };

        console.log('✅ Кнопка "Показать ещё" подключена');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// ФИЛЬТРЫ ГОСЗАКУПОК — РАБОЧАЯ ВЕРСИЯ (проверена в консоли)
// ═══════════════════════════════════════════════════════════
(function initProcFilters() {
    function hook() {
        const box = document.getElementById('topProcurementFilter');
        if (!box) {
            setTimeout(hook, 300);
            return;
        }

        const buttons = box.querySelectorAll('button');
        if (!buttons.length) {
            setTimeout(hook, 300);
            return;
        }

        console.log('🔧 Подключаю фильтры госзакупок:', buttons.length, 'кнопок');

        buttons.forEach(btn => {
            // Клонируем — сбрасываем старые обработчики
            const fresh = btn.cloneNode(true);
            btn.parentNode.replaceChild(fresh, btn);

            fresh.onclick = function (e) {
                e.preventDefault();

                const filter = this.dataset.filter || 'all';
                console.log('🔍 КЛИК по фильтру:', filter);

                // Подсветка активной кнопки
                box.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Меняем состояние фильтра
                procState.filter = filter;
                procState.visible = 25;

                // Перерисовываем таблицу
                if (typeof renderProcurement === 'function') {
                    renderProcurement();
                }

                console.log('После клика, фильтр =', procState.filter);
            };
        });

        console.log('✅ Фильтры госзакупок подключены');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// КНОПКА «ПОКАЗАТЬ ЕЩЁ 25» ДЛЯ ГОСЗАКУПОК
// ═══════════════════════════════════════════════════════════
(function initProcShowMore() {
    function hook() {
        const btn = document.getElementById('topProcurementShowMore');
        if (!btn) {
            setTimeout(hook, 300);
            return;
        }

        btn.onclick = function (e) {
            e.preventDefault();
            console.log('🔘 Показать ещё, было:', procState.visible);
            procState.visible += 25;
            console.log('   стало:', procState.visible);

            if (typeof renderProcurement === 'function') {
                renderProcurement();
            }
        };

        console.log('✅ Кнопка "Показать ещё" подключена');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// КНОПКА «СКРЫТЬ СПИСОК» ДЛЯ ПРИОРИТЕТНЫХ ТОВАРОВ
// ═══════════════════════════════════════════════════════════
(function initTopToggle() {
    function hook() {
        const btn = document.querySelector('#topProductsCard .top-actions .ghost')
                 || document.getElementById('topToggleBtn');

        if (!btn) {
            setTimeout(hook, 300);
            return;
        }

        let collapsed = false;

        btn.onclick = function (e) {
            e.preventDefault();
            collapsed = !collapsed;

            const wrap = document.getElementById('topProductsListWrap');
            const footer = document.getElementById('topProductsFooter');

            if (collapsed) {
                if (wrap) wrap.style.display = 'none';
                if (footer) footer.style.display = 'none';
                btn.textContent = 'Показать список';
            } else {
                if (wrap) wrap.style.display = '';
                if (footer) footer.style.display = '';
                btn.textContent = 'Скрыть список';
            }
            console.log('📋 Список:', collapsed ? 'скрыт' : 'показан');
        };

        console.log('✅ Кнопка "Скрыть список" подключена');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
})();

// ═══════════════════════════════════════════════════════════
// ПОИСК В БЛОКЕ «ПРИОРИТЕТНЫЕ ТОВАРЫ» — ЖЁСТКО
// ═══════════════════════════════════════════════════════════
(function initTopSearchHard() {
    function hook() {
        const input = document.getElementById('topProductsSearch');
        const clearBtn = document.getElementById('clearTopSearch');

        if (!input) {
            setTimeout(hook, 300);
            return;
        }

        APP.topSearch = APP.topSearch || '';

        // Клонируем для сброса старых обработчиков
        const fresh = input.cloneNode(true);
        input.parentNode.replaceChild(fresh, input);

        fresh.oninput = function () {
            APP.topSearch = this.value.trim().toLowerCase();
            console.log('🔍 Поиск приоритетных:', APP.topSearch);

            if (clearBtn) clearBtn.classList.toggle('visible', APP.topSearch.length > 0);

            if (typeof renderTopProducts === 'function' && APP.model) {
                renderTopProducts();
            }
        };

        if (clearBtn) {
            clearBtn.onclick = function () {
                fresh.value = '';
                APP.topSearch = '';
                clearBtn.classList.remove('visible');
                if (typeof renderTopProducts === 'function' && APP.model) {
                    renderTopProducts();
                }
                fresh.focus();
            };
        }

        console.log('✅ Поиск приоритетных подключён');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// KPI КАРТОЧКА ТОВАРА — 7 МЕТРИК
// ═══════════════════════════════════════════════════════════
function renderSelectedProductCard(node) {
    if (!node) return;

    const code = String(
        node.code || node.tnved_code || node.good_code || node["ТИФ ТН коди"] || ''
    ).replace(/\.0$/, '').trim();

    const name = node.name || node.good_name || node["Корхона номи"] || "Без названия";
    const children = node.children || [];

    console.log('🔍 renderSelectedProductCard:', { code, name, childrenCount: children.length });

    APP.selectedCode = code;

    setText('selectedName', name);
    setText('selectedCode', code || '—');
    setText('selectedChainCount', children.length + ' цепочек');

    setText('metricImport',     fmtSum(node.imp || 0));
    setText('metricExport',     fmtSum(node.exp || 0));
    setText('metricProduction', fmtSum(node.prod || 0));
    setText('metricMarket',     fmtSum(node.market || 0));
    setText('metricImportDep',  (node.id || 0).toFixed(1).replace('.', ',') + '%');
    setText('metricProducers',  (node.producerCount || 0).toString());

    // Госзакупки
    let procRows = (APP.raw.procurement || []).filter(r => {
        const rowCode = String(r.good_code || r.tnved_code || '').replace(/\.0$/, '').trim();
        return rowCode === code;
    });

    if (!procRows.length && code.length >= 4) {
        const prefix = code.slice(0, 4);
        procRows = (APP.raw.procurement || []).filter(r => {
            const rowCode = String(r.good_code || '').replace(/\.0$/, '').trim();
            return rowCode.startsWith(prefix);
        });
    }

    if (!procRows.length && name) {
        const nameLower = String(name).toLowerCase().trim().slice(0, 15);
        procRows = (APP.raw.procurement || []).filter(r =>
            String(r.good_name || '').toLowerCase().includes(nameLower)
        );
    }

    const procSum = procRows.reduce((s, r) => s + (Number(r.total_price) || 0), 0);
    setText('metricProcurement', fmtProcSum(procSum));
}

// ═══════════════════════════════════════════════════════════
// ДЕРЕВО ДЛЯ ВЫБРАННОГО КОДА
// ═══════════════════════════════════════════════════════════
function renderTreeForCode(parentCode) {
    const container = document.getElementById('treeContainer');
    if (!container) {
        console.warn('⚠ #treeContainer не найден');
        return;
    }

    _treeRenderCount = 0;

    if (!parentCode) {
        const roots = buildTreeFromConnection();
        if (!roots || !roots.length) {
            container.innerHTML = '<div style="padding:14px;color:#991b1b;">Нет данных для дерева</div>';
            return;
        }
        parentCode = roots[0].code;
        APP.selectedCode = parentCode;
    }

    const rootNode = buildTreeForCode(parentCode);

    if (!rootNode) {
        container.innerHTML = `<div style="padding:14px;color:#94a3b8;text-align:center;">
            📌 Для кода <b>${parentCode}</b> нет данных о компонентах
        </div>`;
        return;
    }

    container.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'tree';

    try {
        ul.appendChild(renderTreeNode(rootNode, 0, new Set()));
        container.appendChild(ul);
        console.log('🌳 Дерево отрисовано для', parentCode, '| узлов:', _treeRenderCount);
        updateTariffBanner(rootNode, parentCode);
    } catch (err) {
        console.error('❌ Ошибка в renderTreeForCode:', err);
        container.innerHTML = `<div style="padding:14px;color:#991b1b;">
            Ошибка отрисовки дерева: ${err.message}
        </div>`;

        // ═══ ЗАПОЛНЕНИЕ ПЛАШКИ ТАРИФНОЙ РЕКОМЕНДАЦИИ ═══
        updateTariffBanner(rootNode, parentCode);
    }
}

// ═══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧАТЕЛЬ ТЕМЫ В ВЕРХНЕЙ ПОЛОСКЕ
// ═══════════════════════════════════════════════════════════
(function initTopThemeToggle() {
    function hook() {
        const btn = document.getElementById('themeToggle');
        if (!btn) {
            setTimeout(hook, 300);
            return;
        }

        const sun = btn.querySelector('.icon-sun');
        const moon = btn.querySelector('.icon-moon');

        // Синхронизируемся с текущей темой
        function updateIcon() {
            const isDark = document.body.classList.contains('theme-dark');
            if (sun)  sun.style.display  = isDark ? 'none' : 'block';
            if (moon) moon.style.display = isDark ? 'block' : 'none';
        }
        updateIcon();

        btn.onclick = () => {
            const isDark = document.body.classList.contains('theme-dark');
            const newTheme = isDark ? 'light' : 'dark';

            document.body.classList.toggle('theme-dark', newTheme === 'dark');
            localStorage.setItem('theme', newTheme);
            updateIcon();

            // Обновляем график
            if (typeof renderMarketChart === 'function' && APP.model) {
                renderMarketChart();
            }

            console.log('🎨 Тема переключена:', newTheme);
        };

        console.log('✅ Переключатель темы в top-bar подключён');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧАТЕЛЬ ЯЗЫКА (RU ↔ UZ)
// ═══════════════════════════════════════════════════════════

// Словарь переводов
const TRANSLATIONS = {
    ru: {
        'Карта сайта': 'Карта сайта',
        'Ko\'zi ojizlar uchun': 'Для слабовидящих',
        'Обновить': 'Обновить',
        'Показать список': 'Показать список',
        'Скрыть список': 'Скрыть список',
        'Поиск конечного товара': 'Поиск конечного товара',
        'Введите код ТН ВЭД или наименование товара...': 'Введите код ТН ВЭД или наименование товара...',
        'Параметры анализа': 'Параметры анализа',
        'Поиск': 'Поиск',
        'Курс доллара (сум)': 'Курс доллара (сум)',
        'Минимальный балл': 'Минимальный балл',
        'Период': 'Период',
        'Все периоды': 'Все периоды',
        'Регионы': 'Регионы',
        'Все регионы': 'Все регионы',
        'Приоритетные товары': 'Приоритетные товары',
        'Рейтинг приоритетных товаров': 'Рейтинг приоритетных товаров',
        'Потенциальный рынок': 'Потенциальный рынок',
        'Средняя импортозависимость': 'Средняя импортозависимость',
        'Потенциал локализации': 'Потенциал локализации',
        'Товар и код ТН ВЭД': 'Товар и код ТН ВЭД',
        'Потенциал': 'Потенциал',
        'Рынок': 'Рынок',
        'Импортозависимость': 'Импортозависимость',
        'Экспорт': 'Экспорт',
        'Производство': 'Производство',
        'Общий балл': 'Общий балл',
        'Рекомендация': 'Рекомендация',
        'Товары с высокой импортозависимостью': 'Товары с высокой импортозависимостью',
        'Рынок и местное производство': 'Рынок и местное производство',
        'Товары с тарифной инверсией': 'Товары с тарифной инверсией',
        'Топ продукции в госзакупках': 'Топ продукции в госзакупках',
        'Показатели выбранного товара': 'Показатели выбранного товара',
        'Иерархия производства — дерево': 'Иерархия производства — дерево',
        'Импортёры': 'Импортёры',
        'Экспортёры': 'Экспортёры',
        'Производители': 'Производители',
        'Аналитика всех узлов выбранной цепочки': 'Аналитика всех узлов выбранной цепочки',
        'Объём импорта': 'Объём импорта',
        'Объём экспорта': 'Объём экспорта',
        'Объём госзакупок': 'Объём госзакупок',
        'Объём рынка': 'Объём рынка',
        'Производителей': 'Производителей',
        'Поддерживать': 'Поддерживать',
        'Локализация': 'Локализация',
        'Создать производство': 'Создать производство',
        'Рынок = производство + импорт − экспорт': 'Рынок = производство + импорт − экспорт',
        'Показано': 'Показано',
        'из': 'из',
        'Показать ещё 10': 'Показать ещё 10',
        'Показать ещё 25': 'Показать ещё 25',
        'Все': 'Все',
        'Предприятие': 'Предприятие',
        'Вне реестра': 'Вне реестра',
        'Код или наименование': 'Код или наименование',
        'Превышение ↓': 'Превышение ↓',
        'Код ТН ВЭД': 'Код ТН ВЭД',
        'Наименование товара': 'Наименование товара',
        'Ставка товара': 'Ставка товара',
        'Сумма ставок компонентов': 'Сумма ставок компонентов',
        'Компонентов': 'Компонентов',
        'Импортёр': 'Импортёр',
        'Экспортёр': 'Экспортёр',
        'Производитель': 'Производитель',
        'Объём': 'Объём',
        'ИНН': 'ИНН',
        'Уровень': 'Уровень',
        'Товар': 'Товар',
        'Импорт': 'Импорт',
        'Решение': 'Решение',
    },
    uz: {
        'Карта сайта': 'Sayt xaritasi',
        'Для слабовидящих': 'Ko\'zi ojizlar uchun',
        'Обновить': 'Ma\'lumotlarni yangilash',
        'Показать список': 'Ro\'yxatni ko\'rsatish',
        'Скрыть список': 'Ro\'yxatni yashirish',
        'Поиск конечного товара': 'Yakuniy tovarni qidirish',
        'Введите код ТН ВЭД или наименование товара...': 'TIF TN kodini yoki tovar nomini kiriting...',
        'Параметры анализа': 'Tahlil parametrlari',
        'Поиск': 'Qidiruv',
        'Курс доллара (сум)': 'Dollar kursi (so\'m)',
        'Минимальный балл': 'Minimal ball',
        'Период': 'Davr',
        'Все периоды': 'Barcha davrlar',
        'Регионы': 'Hududlar',
        'Все регионы': 'Barcha hududlar',
        'Приоритетные товары': 'Ustuvor tovarlar',
        'Рейтинг приоритетных товаров': 'Ustuvor tovarlar reytingi',
        'Потенциальный рынок': 'Potensial bozor',
        'Средняя импортозависимость': 'O\'rtacha importga qaramlik',
        'Потенциал локализации': 'Mahalliylashtirish salohiyati',
        'Товар и код ТН ВЭД': 'Tovar va TIF TN kodi',
        'Потенциал': 'Salohiyat',
        'Рынок': 'Bozor',
        'Импортозависимость': 'Importga qaramlik',
        'Экспорт': 'Eksport',
        'Производство': 'Ishlab chiqarish',
        'Общий балл': 'Umumiy ball',
        'Рекомендация': 'Tavsiya',
        'Товары с высокой импортозависимостью': 'Importga qaramligi yuqori bo\'lgan tovarlar',
        'Рынок и местное производство': 'Bozor va mahalliy ishlab chiqarish',
        'Товары с тарифной инверсией': 'Tarif inversiyasi bo\'lgan tovarlar',
        'Топ продукции в госзакупках': 'Davlat xaridlaridagi top mahsulotlar',
        'Показатели выбранного товара': 'Tanlangan tovar ko\'rsatkichlari',
        'Иерархия производства — дерево': 'Ishlab chiqarish ierarxiyasi — daraxt',
        'Импортёры': 'Importchilar',
        'Экспортёры': 'Eksportchilar',
        'Производители': 'Ishlab chiqaruvchilar',
        'Аналитика всех узлов выбранной цепочки': 'Tanlangan zanjirning barcha tugunlari tahlili',
        'Объём импорта': 'Import hajmi',
        'Объём экспорта': 'Eksport hajmi',
        'Объём госзакупок': 'Davlat xaridlari hajmi',
        'Объём рынка': 'Bozor hajmi',
        'Производителей': 'Ishlab chiqaruvchilar',
        'Поддерживать': 'Qo\'llab-quvvatlash',
        'Локализация': 'Mahalliylashtirish',
        'Создать производство': 'Ishlab chiqarishni yaratish',
        'Рынок = производство + импорт − экспорт': 'Bozor = ishlab chiqarish + import − eksport',
        'Показано': 'Ko\'rsatildi',
        'из': 'dan',
        'Показать ещё 10': 'Yana 10 ta ko\'rsatish',
        'Показать ещё 25': 'Yana 25 ta ko\'rsatish',
        'Все': 'Barchasi',
        'Предприятие': 'Korxona',
        'Вне реестра': 'Reyestrdan tashqari',
        'Код или наименование': 'Kod yoki nom',
        'Превышение ↓': 'Ortiqcha ↓',
        'Код ТН ВЭД': 'TIF TN kodi',
        'Наименование товара': 'Tovar nomi',
        'Ставка товара': 'Tovar stavkasi',
        'Сумма ставок компонентов': 'Komponentlar stavkalari yig\'indisi',
        'Компонентов': 'Komponentlar',
        'Импортёр': 'Importchi',
        'Экспортёр': 'Eksportchi',
        'Производитель': 'Ishlab chiqaruvchi',
        'Объём': 'Hajm',
        'ИНН': 'STIR',
        'Уровень': 'Daraja',
        'Товар': 'Tovar',
        'Импорт': 'Import',
        'Решение': 'Qaror',
    }
};

let currentLang = 'ru';

// ═══════════════════════════════════════════════════════════
// ФУНКЦИЯ ПЕРЕВОДА
// ═══════════════════════════════════════════════════════════
function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);

    const dict = TRANSLATIONS[lang] || TRANSLATIONS.ru;
    const ru = TRANSLATIONS.ru;

    // Меняем все текстовые узлы
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function (node) {
                // Пропускаем скрипты, стили, пустые
                const p = node.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                if (['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA'].includes(p.tagName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                const t = node.textContent.trim();
                if (!t) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(node => {
        const text = node.textContent.trim();
        // Ищем по русскому оригиналу (в нём ключи)
        if (ru[text]) {
            node.textContent = node.textContent.replace(text, dict[text] || text);
        } else {
            // Обратный поиск — если сейчас узбекский, переводим на русский
            for (const [keyRu, valUz] of Object.entries(TRANSLATIONS.uz)) {
                if (text === valUz) {
                    node.textContent = node.textContent.replace(text, lang === 'uz' ? valUz : keyRu);
                    break;
                }
            }
        }
    });

    // Меняем placeholder'ы
    document.querySelectorAll('input[placeholder]').forEach(el => {
        const p = el.placeholder;
        if (ru[p]) el.placeholder = dict[p] || p;
    });

    // Меняем title
    document.querySelectorAll('[title]').forEach(el => {
        const t = el.title;
        if (ru[t]) el.title = dict[t] || t;
    });

    console.log('🌐 Язык переключён:', lang);
}

// ═══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧАТЕЛЬ ЯЗЫКА — UI
// ═══════════════════════════════════════════════════════════
(function initLangSwitch() {
    function hook() {
        const langBtn = document.querySelector('.lang-switch');
        if (!langBtn) {
            setTimeout(hook, 300);
            return;
        }

        // Создаём dropdown-меню
        let menu = document.getElementById('langMenu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'langMenu';
            menu.className = 'lang-menu';
            menu.innerHTML = `
                <div class="lang-item" data-lang="ru">🇷🇺 Русский</div>
                <div class="lang-item" data-lang="uz">🇺🇿 O'zbekcha</div>
            `;
            langBtn.appendChild(menu);
        }

        // Текущий язык из хранилища
        const savedLang = localStorage.getItem('lang') || 'ru';
        currentLang = savedLang;
        updateLangLabel(savedLang);

        function updateLangLabel(lang) {
            const label = langBtn.querySelector('span');
            if (label) label.textContent = lang === 'uz' ? "O'zbekcha" : 'Русский';
        }

        // Клик по кнопке — показать/скрыть меню
        langBtn.onclick = (e) => {
            if (e.target.classList.contains('lang-item')) return;
            e.stopPropagation();
            menu.classList.toggle('open');
        };

        // Клик по языку
        menu.querySelectorAll('.lang-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                const lang = item.dataset.lang;
                applyLanguage(lang);
                updateLangLabel(lang);
                menu.classList.remove('open');
            };
        });

        // Клик мимо — закрыть
        document.addEventListener('click', (e) => {
            if (!langBtn.contains(e.target)) {
                menu.classList.remove('open');
            }
        });

        // Применяем сохранённый язык
        if (savedLang !== 'ru') {
            applyLanguage(savedLang);
        }

        console.log('✅ Переключатель языка подключён');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧАТЕЛЬ ВАЛЮТЫ ГОСЗАКУПОК — ЕДИНСТВЕННЫЙ
// ═══════════════════════════════════════════════════════════
(function initCurrencySwitch() {
    function hook() {
        const box = document.getElementById('topProcurementCurrency');
        if (!box) {
            setTimeout(hook, 300);
            return;
        }

        const buttons = box.querySelectorAll('button');
        if (!buttons.length) {
            setTimeout(hook, 300);
            return;
        }

        console.log('💱 Подключаю кнопки валюты:', buttons.length);

        buttons.forEach(btn => {
            // Клонируем — стираем ВСЕ старые обработчики
            const fresh = btn.cloneNode(true);
            btn.parentNode.replaceChild(fresh, btn);
        });

        // Переполучаем после клонирования
        const newButtons = box.querySelectorAll('button');

        newButtons.forEach(btn => {
            btn.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();

                const cur = this.dataset.cur || 'UZS';

                // Игнорируем, если уже активна
                if (this.classList.contains('active')) {
                    console.log('💱 Уже активно:', cur);
                    return;
                }

                console.log('💱 Переключение на:', cur);

                // Классы
                newButtons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Глобальные переменные
                APP.currency = cur;
                window.topProcurementState = window.topProcurementState || {};
                window.topProcurementState.currency = cur;

                // 🔥 Перерисовываем ТОЛЬКО таблицу госзакупок
                try {
                    if (typeof renderProcurement === 'function') {
                        renderProcurement();
                    }
                    console.log('✅ Таблица госзакупок перерисована');
                } catch (err) {
                    console.error('❌ Ошибка перерисовки:', err);
                }
            };
        });

        console.log('✅ Кнопки валюты подключены (единственный раз)');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    // Убираем повторный `window.addEventListener('load', hook)` — он создаёт дубли!
})();

// ═══════════════════════════════════════════════════════════
// КНОПКА «ВСЕ» ДЛЯ ИМПОРТОЗАВИСИМОСТИ
// ═══════════════════════════════════════════════════════════
(function initImportDepShowAll() {
    function hook() {
        const btn = document.getElementById('importDepShowAll');
        if (!btn) {
            setTimeout(hook, 300);
            return;
        }

        let showAll = false;

        btn.onclick = function () {
            showAll = !showAll;
            this.textContent = showAll ? 'Свернуть' : 'Все';

            // Меняем лимит и перерисовываем
            window.IMPORT_DEP_LIMIT = showAll ? 50 : 10;

            if (typeof renderImportDependency === 'function') {
                renderImportDependency();
            }

            console.log('📊 Импортозависимость:', showAll ? 'все' : 'топ-10');
        };

        console.log('✅ Кнопка "Все" для импортозависимости подключена');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// ДОБАВЛЯЕМ КНОПКУ «ВСЕ» И ПАГИНАЦИЮ ЧЕРЕЗ JS
// (не трогая HTML)
// ═══════════════════════════════════════════════════════════
(function injectImportDepUI() {
    function hook() {
        const list = document.getElementById('importDependencyList');
        if (!list) {
            setTimeout(hook, 300);
            return;
        }

        // Найти родительскую .card
        const card = list.closest('.card');
        if (!card) {
            console.warn('⚠ .card родитель не найден');
            return;
        }

        // Найти .top-head внутри card
        let head = card.querySelector('.top-head');
        if (!head) {
            // Создать top-head если нет
            head = document.createElement('div');
            head.className = 'top-head';
            head.innerHTML = `
                <div>
                    <h2 class="h2title">
                        <span class="sec-ico">📊</span>
                        <span>Товары с высокой импортозависимостью</span>
                    </h2>
                    <div class="small">Товары с наибольшей долей импорта во внутреннем потреблении</div>
                </div>
            `;
            card.insertBefore(head, card.firstChild);
        }

        // Добавить кнопку «Все» в top-head, если нет
        if (!document.getElementById('importDepShowAll')) {
            const actions = document.createElement('div');
            actions.className = 'top-actions';
            actions.innerHTML = `<button id="importDepShowAll" class="ghost">Все</button>`;
            head.appendChild(actions);

            // Обработчик
            document.getElementById('importDepShowAll').onclick = function () {
                const showAll = this.textContent === 'Все';
                this.textContent = showAll ? 'Свернуть' : 'Все';
                window.IMPORT_DEP_LIMIT = showAll ? 50 : 10;
                if (typeof renderImportDependency === 'function') renderImportDependency();
            };
        }

        // Добавить пагинацию после списка
        if (!document.getElementById('importDepPagination')) {
            const pag = document.createElement('div');
            pag.id = 'importDepPagination';
            pag.className = 'pagination';
            list.parentNode.insertBefore(pag, list.nextSibling);
        }

        console.log('✅ Кнопка "Все" и пагинация добавлены через JS');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();

// ═══════════════════════════════════════════════════════════
// ЗАПОЛНЕНИЕ ПЛАШКИ ТАРИФНОЙ РЕКОМЕНДАЦИИ
// ═══════════════════════════════════════════════════════════
function updateTariffBanner(node, code) {
    if (!node) {
        console.warn('⚠ updateTariffBanner: нет node');
        return;
    }

    console.log('📋 Обновление плашки для:', code, '| node.code:', node.code);

    // Собираем ВСЕ узлы дерева
    const allNodes = [];
    function walk(n) {
        if (!n) return;
        allNodes.push(n);
        if (n.children && n.children.length) {
            n.children.forEach(walk);
        }
    }
    walk(node);

    console.log('   Узлов в дереве:', allNodes.length);

    // Ставка Parent
    const parentRate = node.rate || 5;

    // Сумма ставок ВСЕХ узлов, кроме Parent
    let sumRate = 0;
    let foundCount = 0;

    allNodes.forEach(n => {
        if (n === node) return;   // пропускаем Parent
        if (n.rate && n.rate > 0) {
            sumRate += n.rate;
            foundCount++;
        }
    });

    const totalComponents = allNodes.length - 1;

    console.log('   Parent rate:', parentRate, '| Sum:', sumRate, '| Found:', foundCount, '/', totalComponents);

    // Заполняем DOM
    const el1 = document.getElementById('trParentRate');
    const el2 = document.getElementById('trSumRate');
    const el3 = document.getElementById('trFound');
    const el4 = document.getElementById('trHint');

    if (el1) el1.textContent = parentRate + '%';
    if (el2) el2.textContent = Math.round(sumRate) + '%';
    if (el3) el3.textContent = foundCount + '/' + totalComponents;
    if (el4) el4.textContent = `Parent: ${code} — автоматическая модель. Итоговая сумма рассчитана по всем кодам компонентов (${allNodes.length} узлов).`;

    console.log('✅ Плашка обновлена');
}

// ═══════════════════════════════════════════════════════════
// ОБРАБОТЧИКИ ШАПКИ АНАЛИТИКИ
// ═══════════════════════════════════════════════════════════
(function initAnalyticsControls() {
    function hook() {
        // Валюта
        const curBox = document.getElementById('analyticsCurrency');
        if (curBox) {
            curBox.querySelectorAll('button').forEach(btn => {
                btn.onclick = function () {
                    curBox.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    APP.currency = this.dataset.cur || 'UZS';
                    if (APP.selectedCode) {
                        const node = APP.model.products.get(APP.selectedCode);
                        if (node) renderChainAnalytics(node);
                    }
                    console.log('💱 Аналитика — валюта:', APP.currency);
                };
            });
        }

        // Поиск
        const searchInput = document.getElementById('analyticsSearch');
        if (searchInput) {
            searchInput.oninput = function () {
                const q = this.value.trim().toLowerCase();
                const tbody = document.getElementById('chainAnalyticsBody');
                if (!tbody) return;
                tbody.querySelectorAll('tr').forEach(tr => {
                    const text = tr.textContent.toLowerCase();
                    tr.style.display = (!q || text.includes(q)) ? '' : 'none';
                });
            };
        }

        // Фильтры
        const filterBox = document.getElementById('analyticsFilter');
        if (filterBox) {
            filterBox.querySelectorAll('button').forEach(btn => {
                btn.onclick = function () {
                    filterBox.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    console.log('🔍 Фильтр аналитики:', this.dataset.filter);
                    // TODO: добавить логику фильтрации
                };
            });
        }

        console.log('✅ Шапка аналитики подключена');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hook);
    } else {
        hook();
    }
    window.addEventListener('load', hook);
})();