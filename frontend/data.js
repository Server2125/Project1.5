// frontend/data.js
// Сборка дерева из широкой таблицы connection (Level1..LevelN в колонках)

// ─── Утилиты ────────────────────────────────────────────────
function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const s = String(v).replace(/\s/g, '').replace(/\u00A0/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function cleanCode(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\.0+$/, '').replace(/\s/g, '').trim();
}

function str(v) {
    return v === null || v === undefined ? '' : String(v).trim();
}

// ─── Главная функция ────────────────────────────────────────
window.buildDataModel = function(raw) {
    const { connection, imports, exports, production } = raw;

    // 1. Определяем, сколько уровней есть в connection.
    //    Ищем все ключи вида LevelN_code
    let maxLevel = 0;
    if (connection && connection.length) {
        const keys = Object.keys(connection[0]);
        keys.forEach(k => {
            const m = k.match(/^Level(\d+)_code$/i);
            if (m) maxLevel = Math.max(maxLevel, parseInt(m[1], 10));
        });
    }
    console.log('📊 Уровней в connection:', maxLevel);

    // 2. Строим индекс товаров: code → { code, name, parent, level, children }
    const products = new Map();

    function ensureNode(code, name, parent, level) {
        code = cleanCode(code);
        if (!code) return null;
        if (!products.has(code)) {
            products.set(code, {
                code,
                name: str(name),
                parent: cleanCode(parent) || null,
                level: level,
                children: [],
            });
        } else {
            const n = products.get(code);
            if (name && !n.name) n.name = str(name);
            // Обновляем parent, если сейчас пусто и есть
            if (!n.parent && parent) n.parent = cleanCode(parent);
            // Берём минимальный level (товар может встречаться на разных уровнях)
            if (level < n.level) n.level = level;
        }
        return products.get(code);
    }

    // 3. Проходим по всем строкам connection
    (connection || []).forEach(row => {
        // Родитель — всегда нулевой уровень
        const rootCode = cleanCode(row.Parent_code);
        const rootName = str(row.Parent_name);
        if (rootCode) ensureNode(rootCode, rootName, null, 0);

        // Уровни 1..N
        let prevCode = rootCode;
        for (let i = 1; i <= maxLevel; i++) {
            const codeKey = `Level${i}_code`;
            const nameKey = `Level${i}_name`;
            const code = cleanCode(row[codeKey]);
            const name = str(row[nameKey]);
            if (!code) continue;

            const node = ensureNode(code, name, prevCode, i);

            // Прикрепляем к родителю (если ещё не прикреплён)
            if (prevCode && products.has(prevCode)) {
                const parentNode = products.get(prevCode);
                if (!parentNode.children.includes(node)) {
                    parentNode.children.push(node);
                }
            }

            prevCode = code;
        }
    });

    console.log('📚 Индекс товаров:', products.size);

    // 4. Считаем метрики
    // Импорт: tnved_code → сумма cost_usd
    const impMap = new Map();
    (imports || []).forEach(r => {
        const code = cleanCode(r.tnved_code);
        if (!code) return;
        impMap.set(code, (impMap.get(code) || 0) + num(r.cost_usd));
    });

    // Экспорт: обычно тоже tnved_code
    const expMap = new Map();
    (exports || []).forEach(r => {
        const code = cleanCode(r.tnved_code || r.code);
        if (!code) return;
        expMap.set(code, (expMap.get(code) || 0) + num(r.cost_usd || r.value));
    });

    // Производство: "ТИФ ТН коди" → сумма по "Объем производственной продукции тыс.сум"
    // Производство: объём в тыс. сум → конвертируем в USD
const RATE_UZS_PER_USD = 12600;
const prodMap = new Map();
const prodCountMap = new Map();
const producersByCode = new Map();

(production || []).forEach(r => {
    const code = cleanCode(r['ТИФ ТН коди']);
    if (!code) return;

    // Объём: "Объем производственной продукции тыс.сум" ИЛИ "Ҳажми, минг сўмда"
    let volThousandSum = num(r['Объем производственной продукции тыс.сум']);
    if (!volThousandSum) volThousandSum = num(r['Ҳажми, минг сўмда']);

    // Переводим: тыс.сум → сум → USD
    const volSum = volThousandSum * 1000;         // сум
    const volUSD = volSum / RATE_UZS_PER_USD;     // USD

    prodMap.set(code, (prodMap.get(code) || 0) + volUSD);
    prodCountMap.set(code, (prodCountMap.get(code) || 0) + 1);

    if (!producersByCode.has(code)) producersByCode.set(code, []);
    producersByCode.get(code).push({
        name: str(r['корхона номи']),
        stir: str(r['СТИР']),
        volume: volUSD,
    });
});

    // 5. Приклеиваем метрики к товарам
    for (const [code, node] of products) {
        node.imp  = impMap.get(code)  || 0;
        node.exp  = expMap.get(code)  || 0;
        node.prod = prodMap.get(code) || 0;
        node.market = Math.max(0, node.prod + node.imp - node.exp);
        const denom = node.prod + node.imp;
        node.id  = denom > 0 ? (node.imp / denom) * 100 : 0;
        node.lpi = node.market > 0 ? node.prod / node.market : 0;
        node.producerCount = prodCountMap.get(code) || 0;
        node.manufacturers = producersByCode.get(code) || [];
    }

    // 6. Корни — товары без parent
    const roots = [];
    for (const [code, node] of products) {
        if (!node.parent) roots.push(node);
    }

    console.log('🌳 Корней найдено:', roots.length);
    console.log('📖 Пример корня:', roots[0]);

    return { products, roots };
};

// Плоский список для таблицы аналитики — с защитой от циклов
window.flattenTree = function(root, level = 0, out = [], visited = new Set()) {
    if (!root) return out;

    // 🔒 Защита от циклов
    if (visited.has(root.code)) {
        return out;
    }
    visited.add(root.code);

    // 🔒 Защита от слишком глубокой вложенности
    if (level > 15) {
        return out;
    }

    out.push({ ...root, level });

    if (root.children && root.children.length) {
        root.children.forEach(c => flattenTree(c, level + 1, out, visited));
    }

    return out;
};