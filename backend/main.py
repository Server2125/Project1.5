# ============================================================
#  КАРТА ПРОИЗВОДСТВЕННОЙ КООПЕРАЦИИ — BACKEND API
#  ГИБРИДНЫЙ ИСТОЧНИК: Excel (connection.xlsx) + CSV (data/)
#  Python 3.14, pandas 3.0.6, fastapi 0.141.1
# ============================================================

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from pathlib import Path
import math

# ============================================================
# ИНИЦИАЛИЗАЦИЯ
# ============================================================

app = FastAPI(
    title="Карта кооперации API",
    version="1.0",
    description="API для платформы анализа импортозависимости"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Пути
BASE_DIR   = Path(__file__).parent.parent
EXCEL_FILE = BASE_DIR / "connection.xlsx"
DATA_DIR   = BASE_DIR / "data"

RATE = 12600  # сум / USD

# ============================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================================

def _num(v):
    if v is None:
        return 0.0
    try:
        if isinstance(v, float) and math.isnan(v):
            return 0.0
    except Exception:
        pass
    s = str(v).replace(" ", "").replace(",", ".").replace("№", "").strip()
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def _code(v):
    if v is None:
        return ""
    try:
        if isinstance(v, float) and math.isnan(v):
            return ""
    except Exception:
        pass
    return str(v).replace(".0", "").replace(" ", "").strip()


def _str(v):
    if v is None:
        return ""
    try:
        if isinstance(v, float) and math.isnan(v):
            return ""
    except Exception:
        pass
    return str(v).strip()


def _find_col(df, variants):
    """Найти колонку по списку вариантов"""
    if df is None or df.empty:
        return None
    # точное совпадение
    for v in variants:
        for c in df.columns:
            if str(c).strip().lower() == v.lower():
                return c
    # частичное
    for v in variants:
        for c in df.columns:
            if v.lower() in str(c).strip().lower():
                return c
    return None


# ============================================================
# ГИБРИДНАЯ ЗАГРУЗКА: Excel → CSV (fallback)
# ============================================================

def load_sheet_or_csv(sheet_name, csv_names):
    """
    Пытается загрузить лист из Excel.
    Если не получается — берёт CSV из data/.
    csv_names — список возможных имён CSV-файлов.
    """
    # 1. Пробуем Excel
    if EXCEL_FILE.exists():
        try:
            df = pd.read_excel(EXCEL_FILE, sheet_name=sheet_name, dtype=str)
            df.columns = df.columns.str.strip()  # ← убирает пробелы из названий колонок
            df = df.rename(columns={'TNVED': 'tnved_code', 'Stavka': 'rate'})
            df = df[[c for c in df.columns if not str(c).startswith('__EMPTY')]]
            if not df.empty:
                print(f"✅ [Excel] {sheet_name}: {len(df)} строк")
                return df
        except Exception as e:
            print(f"⚠ Excel-лист '{sheet_name}': {e}")

    # 2. Fallback — CSV
    for csv_name in csv_names:
        path = DATA_DIR / csv_name
        if path.exists():
            try:
                df = pd.read_csv(path, sep=None, engine="python", dtype=str)
                df.columns = df.columns.str.strip()
                df = df.rename(columns={'TNVED': 'tnved_code', 'Stavka': 'rate'})
                df = df[[c for c in df.columns if not str(c).startswith('__EMPTY')]]
                if not df.empty:
                    print(f"✅ [CSV]   {csv_name}: {len(df)} строк")
                    return df
            except Exception as e:
                print(f"⚠ CSV '{csv_name}': {e}")

    print(f"❌ Нет данных для '{sheet_name}' (ни Excel, ни CSV)")
    return pd.DataFrame()


# ============================================================
# ЗАГРУЗКА ВСЕХ ДАННЫХ
# ============================================================

print("=" * 60)
print("📂 Excel:", EXCEL_FILE)
print("📂 CSV:  ", DATA_DIR)
print("=" * 60)

DATA = {
    "connection":  load_sheet_or_csv("connection",
                                     ["connection.csv"]),
    "import":      load_sheet_or_csv("Import",
                                     ["import.csv", "import_by_inn.csv"]),
    "export":      load_sheet_or_csv("export",
                                     ["export.csv", "export_by_inn.csv"]),
    "prom":        load_sheet_or_csv("prom",
                                     ["manufacture.csv", "prom.csv"]),
    "stavka":      load_sheet_or_csv("stavka",
                                     ["stavka.csv"]),
    "procurement": load_sheet_or_csv("procurement",
                                     ["procurement.csv"]),
    "registry":    load_sheet_or_csv("registry",
                                     ["inn.csv", "registry.csv", "certificates.csv"]),
}


# ============================================================
# ПОСТРОЕНИЕ ИНДЕКСОВ
# ============================================================

def build_import_index(df):
    idx = {}
    if df.empty:
        return idx
    col_code  = _find_col(df, ["tnved_code", "ТИФ ТН коди", "ТН ВЭД, код", "tnvcd_code"])
    col_inn   = _find_col(df, ["inn", "ИНН", "ИНН поставщика"])
    col_count = _find_col(df, ["country_code", "Страна", "country"])
    col_usd   = _find_col(df, ["invoice_price_usd", "statistical_price_usd", "cost_usd"])

    print(f"  Import: code={col_code}, inn={col_inn}, usd={col_usd}")

    if not col_code or not col_usd:
        return idx

    for _, r in df.iterrows():
        code = _code(r[col_code])
        if not code:
            continue
        idx.setdefault(code, []).append({
            "inn":     _str(r[col_inn]) if col_inn else "",
            "country": _str(r[col_count]) if col_count else "",
            "costUSD": _num(r[col_usd]),
        })
    return idx


def build_export_index(df):
    idx = {}
    if df.empty:
        return idx
    col_code  = _find_col(df, ["tnved_code", "ТИФ ТН коди", "ТН ВЭД, код", "tnvcd_code"])
    col_inn   = _find_col(df, ["inn", "ИНН"])
    col_count = _find_col(df, ["country_code", "Страна", "country"])
    col_usd   = _find_col(df, ["invoice_price_usd", "statistical_price_usd", "cost_usd"])

    print(f"  Export: code={col_code}, inn={col_inn}, usd={col_usd}")

    if not col_code or not col_usd:
        return idx

    for _, r in df.iterrows():
        code = _code(r[col_code])
        if not code:
            continue
        idx.setdefault(code, []).append({
            "inn":     _str(r[col_inn]) if col_inn else "",
            "country": _str(r[col_count]) if col_count else "",
            "costUSD": _num(r[col_usd]),
        })
    return idx


def build_prom_index(df):
    idx = {}
    if df.empty:
        return idx
    col_code = _find_col(df, ["tnved_code", "ТИФ ТН коди", "ТН ВЭД, код"])
    col_inn  = _find_col(df, ["inn", "ИНН", "Корхона номи", "Наименование предприятий"])
    col_usd  = _find_col(df, ["manufacture_usd",
                              "Ҳажми, минг сўмда",
                              "Объем производственной продукции тыс.сум"])

    print(f"  Prom:   code={col_code}, inn={col_inn}, usd={col_usd}")

    if not col_code or not col_usd:
        return idx

    for _, r in df.iterrows():
        code = _code(r[col_code])
        if not code:
            continue
        idx.setdefault(code, []).append({
            "inn":     _str(r[col_inn]) if col_inn else "",
            "company": _str(r[col_inn]) if col_inn else "",
            "volume":  _num(r[col_usd]),
        })
    return idx


IMP_IDX  = build_import_index(DATA["import"])
EXP_IDX  = build_export_index(DATA["export"])
PROM_IDX = build_prom_index(DATA["prom"])

print(f"  📥 Импорт:       {len(IMP_IDX)} кодов")
print(f"  📤 Экспорт:      {len(EXP_IDX)} кодов")
print(f"  🏭 Производство: {len(PROM_IDX)} кодов")
print("=" * 60)


# ============================================================
# АГРЕГАЦИЯ
# ============================================================

def aggregate(code):
    imp_rows  = IMP_IDX.get(code, [])
    exp_rows  = EXP_IDX.get(code, [])
    prom_rows = PROM_IDX.get(code, [])

    import_usd = sum(r["costUSD"] for r in imp_rows)
    export_usd = sum(r["costUSD"] for r in exp_rows)
    prod_usd   = sum(r["volume"] for r in prom_rows)

    market = prod_usd + import_usd - export_usd

    if market > 0:
        dependency   = import_usd / market
        localization = prod_usd / market
    else:
        dependency = None
        localization = None

    producers = {r["company"] for r in prom_rows if r["company"]}

    return {
        "importUSD": round(import_usd, 2),
        "exportUSD": round(export_usd, 2),
        "prodUSD":   round(prod_usd, 2),
        "market":    round(market, 2),
        "importDependency":  round(dependency, 4) if dependency is not None else None,
        "localizationIndex": round(localization, 4) if localization is not None else None,
        "producerCount": len(producers),
        "imports":       imp_rows[:50],
        "exports":       exp_rows[:50],
        "manufacturers": prom_rows[:50],
    }


# ============================================================
# ENDPOINTS
# ============================================================

@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "API работает. Открой /docs",
        "endpoints": [
            "/api/parents",
            "/api/product/{code}",
            "/api/top-products",
            "/api/procurement",
            "/api/tariff-inversion",
            "/api/currency-rate",
            "/api/search?q=",
        ],
    }


@app.get("/api/parents")
def get_parents(limit: int = 10000, offset: int = 0):
    df = DATA["connection"]
    if df.empty:
        return {"status": "ok", "total": 0, "items": []}

    col_code = _find_col(df, ["Parent_code", "Parent_код"])
    col_name = _find_col(df, ["Parent_name", "Parent_название"])

    if not col_code or not col_name:
        raise HTTPException(500, "В connection нет Parent_code / Parent_name")

    items = df[[col_code, col_name]].drop_duplicates()
    items.columns = ["code", "name"]
    items["code"] = items["code"].apply(_code)
    items["name"] = items["name"].apply(_str)
    items = items[(items["code"] != "") & (items["name"] != "")]

    total = len(items)
    items = items.iloc[offset:offset + limit]

    return {
        "status": "ok",
        "total": total,
        "items": items.to_dict(orient="records"),
    }


@app.get("/api/product/{code}")
def get_product(code: str):
    code = _code(code)
    if not code:
        raise HTTPException(400, "Пустой код")

    df = DATA["connection"]
    if df.empty:
        raise HTTPException(404, "Нет данных")

    col_code = _find_col(df, ["Parent_code", "Parent_код"])
    col_name = _find_col(df, ["Parent_name", "Parent_название"])

    rows = df[df[col_code].apply(_code) == code]
    if rows.empty:
        raise HTTPException(404, f"Товар {code} не найден")

    name = _str(rows.iloc[0][col_name])
    tree = []
    seen = set()

    for _, r in rows.iterrows():
        c0 = _code(r[col_code])
        n0 = _str(r[col_name])
        if c0 and (0, c0) not in seen:
            seen.add((0, c0))
            tree.append({"level": 0, "code": c0, "name": n0})

        for i in range(1, 11):
            lc = _find_col(df, [f"Level{i}_code", f"Level{i}_код"])
            ln = _find_col(df, [f"Level{i}_name", f"Level{i}_название"])
            if not lc or not ln:
                continue
            c = _code(r[lc])
            n = _str(r[ln])
            if c and (i, c) not in seen:
                seen.add((i, c))
                tree.append({"level": i, "code": c, "name": n})

    metrics = aggregate(code)

    return {
        "status": "ok",
        "code": code,
        "name": name,
        "metrics": {k: v for k, v in metrics.items()
                    if k not in ("imports", "exports", "manufacturers")},
        "tree": tree,
        "imports": metrics["imports"],
        "exports": metrics["exports"],
        "manufacturers": metrics["manufacturers"],
        "suppliers": [],
    }


@app.get("/api/top-products")
def get_top_products(limit: int = 100):
    df = DATA["connection"]
    if df.empty:
        return {"status": "ok", "items": []}

    col_code = _find_col(df, ["Parent_code", "Parent_код"])
    col_name = _find_col(df, ["Parent_name", "Parent_название"])

    parents = (
        df[[col_code, col_name]]
        .drop_duplicates()
        .rename(columns={col_code: "code", col_name: "name"})
    )
    parents["code"] = parents["code"].apply(_code)
    parents["name"] = parents["name"].apply(_str)
    parents = parents[(parents["code"] != "") & (parents["name"] != "")]

    products = []
    for _, p in parents.iterrows():
        m = aggregate(p["code"])
        if m["market"] <= 0 and m["importUSD"] <= 0:
            continue
        products.append({
            "code": p["code"],
            "name": p["name"],
            "market": m["market"],
            "importDependency": m["importDependency"],
            "localizationIndex": m["localizationIndex"],
            "prodUSD": m["prodUSD"],
        })

    if not products:
        return {"status": "ok", "items": []}

    max_market = max(p["market"] for p in products) or 1
    max_prod   = max(p["prodUSD"] for p in products) or 1
    log_market = math.log1p(max_market) or 1
    log_prod   = math.log1p(max_prod) or 1

    for p in products:
        market_score = min(1.0, math.log1p(max(p["market"], 0)) / log_market)
        dep_score    = p["importDependency"] if p["importDependency"] is not None else 0
        loc_index    = p["localizationIndex"] if p["localizationIndex"] is not None else 0
        prod_score   = min(1.0, 1 - (math.log1p(max(p["prodUSD"], 0)) / log_prod))

        priority = (market_score * dep_score * (1 - loc_index) * prod_score) ** 0.25 * 100
        p["priorityScore"] = round(priority, 1)

    products.sort(key=lambda x: -x["priorityScore"])
    products = products[:limit]

    for i, p in enumerate(products, 1):
        p["rank"] = i

    return {"status": "ok", "items": products}


# ============================================================
# /api/procurement — ГОСЗАКУПКИ
# ============================================================
@app.get("/api/procurement")
def get_procurement():
    sheets = load_xlsx_sheets()

    # 1. Ищем лист procurement (без учёта регистра)
    result = None
    for sheet_name, rows in sheets.items():
        if sheet_name.strip().lower() in ("procurement", "закупки", "закупка", "purchase"):
            result = rows
            print(f"✅ Найден лист procurement: '{sheet_name}' ({len(rows)} строк)")
            break

    if result is None:
        print("❌ Лист procurement НЕ найден! Доступные листы:", list(sheets.keys()))
        return []

    if not result:
        print("⚠️ Лист procurement пустой")
        return []

    # 2. Показываем колонки первой строки (для отладки)
    first = result[0]
    columns = list(first.keys())
    print(f"📋 Колонок: {len(columns)}")
    print(f"📋 Колонки: {columns}")

    # 3. Нормализуем total_price: превращаем " total_price " → "total_price"
    #    и число → float (убираем пробелы в числах)
    cleaned = []
    for row in result:
        clean_row = {}
        for k, v in row.items():
            # Убираем пробелы в имени колонки
            key = str(k).strip()
            # Приводим known-числовые поля к числу
            if key in ("total_price", "quantity", "price", "cost", "amount"):
                try:
                    # "1 500,50" → 1500.50
                    if isinstance(v, str):
                        v = v.replace(" ", "").replace("\u00A0", "").replace(",", ".")
                    v = float(v) if v not in (None, "") else 0.0
                except (ValueError, TypeError):
                    v = 0.0
            clean_row[key] = v
        cleaned.append(clean_row)

    # 4. Проверяем, что total_price теперь есть и это число
    first_clean = cleaned[0]
    if "total_price" in first_clean:
        sample = first_clean["total_price"]
        print(f"✅ total_price в первой строке: {sample} (тип {type(sample).__name__})")
    else:
        print(f"⚠️ В строке НЕТ ключа 'total_price'. Доступные ключи: {list(first_clean.keys())}")

    # 5. Считаем сумму — для контроля
    total_sum = sum(r.get("total_price", 0) or 0 for r in cleaned)
    print(f"💰 Сумма total_price по всем {len(cleaned)} строкам: {total_sum:,.2f}")

    return cleaned


@app.get("/api/tariff-inversion")
def get_tariff_inversion(limit: int = 100):
    df = DATA["stavka"]
    if df.empty:
        return {"status": "ok", "items": []}

    col_code = _find_col(df, ["tnved_code", "ТН ВЭД, код", "code"])
    col_rate = _find_col(df, ["rate", "ставка", "Ставка"])

    if not col_code or not col_rate:
        return {"status": "ok", "items": []}

    items = []
    for _, r in df.head(limit).iterrows():
        code = _code(r[col_code])
        if not code:
            continue
        items.append({
            "code": code,
            "name": _str(r.get("name", "")) if "name" in df.columns else "",
            "rate": _num(r[col_rate]),
            "materialRate": 0,
            "excess": 0,
        })

    return {"status": "ok", "items": items}


@app.get("/api/currency-rate")
def get_currency_rate():
    return {
        "status": "ok",
        "UZS_per_USD": RATE,
        "updatedAt": "2026-09-22T00:00:00Z",
    }


@app.get("/api/search")
def search(q: str = Query("", min_length=1)):
    q = q.lower().strip()
    df = DATA["connection"]
    if df.empty:
        return {"status": "ok", "items": []}

    col_code = _find_col(df, ["Parent_code", "Parent_код"])
    col_name = _find_col(df, ["Parent_name", "Parent_название"])

    items = df[[col_code, col_name]].drop_duplicates()
    items.columns = ["code", "name"]
    items["code"] = items["code"].apply(_code)
    items["name"] = items["name"].apply(_str)
    items = items[(items["code"] != "") & (items["name"] != "")]

    matched = items[
        items["code"].str.contains(q, na=False, regex=False) |
        items["name"].str.lower().str.contains(q, na=False, regex=False)
    ]

    return {
        "status": "ok",
        "items": matched.head(30).to_dict(orient="records"),
    }
# ============================================================
# ИМПОРТЫ
# ============================================================
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import openpyxl

# ============================================================
# НАСТРОЙКА
# ============================================================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

XLSX_PATH = Path(__file__).parent.parent / "connection.xlsx"

# ============================================================
# ЗАГРУЗКА И КЭШИРОВАНИЕ
# ============================================================
_SHEETS_CACHE = None

def load_xlsx_sheets():
    global _SHEETS_CACHE
    if _SHEETS_CACHE is not None:
        return _SHEETS_CACHE

    if not XLSX_PATH.exists():
        print(f"❌ НЕ НАЙДЕН ФАЙЛ: {XLSX_PATH}")
        return {}

    print(f"📂 Читаю {XLSX_PATH}...")
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    result = {}

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.values)
        if not rows:
            result[sheet_name] = []
            continue

        # ── ОБРАБОТКА ЗАГОЛОВКОВ ──
        # Убираем пробелы по краям: " total_price " → "total_price"
        headers = []
        for i, h in enumerate(rows[0]):
            if h is None:
                headers.append(f"col_{i}")
            else:
                # strip() убирает пробелы и \n \t \r по краям
                headers.append(str(h).strip())

        data = []
        for row in rows[1:]:
            if all(v is None for v in row):
                continue
            data.append({
                headers[i]: row[i]
                for i in range(len(headers))
                if i < len(row)
            })

        result[sheet_name] = data
        print(f"  ✅ {sheet_name}: {len(data)} строк, колонок: {len(headers)}")

    _SHEETS_CACHE = result
    return result


def find_sheet(sheets: dict, aliases: list):
    """Ищет лист по имени (без учёта регистра и частичного совпадения)."""
    for name in sheets.keys():
        norm = name.strip().lower()
        for alias in aliases:
            if norm == alias.lower() or alias.lower() in norm:
                return sheets[name]
    return []


# ============================================================
# ЭНДПОИНТЫ
# ============================================================
@app.get("/api/connection")
def get_connection():
    return find_sheet(load_xlsx_sheets(), ["connection", "связи"])

@app.get("/api/import")
def get_import():
    return find_sheet(load_xlsx_sheets(), ["import", "импорт"])

@app.get("/api/export")
def get_export():
    return find_sheet(load_xlsx_sheets(), ["export", "экспорт"])

@app.get("/api/production")
def get_production():
    return find_sheet(load_xlsx_sheets(), ["prom", "production", "manufacture", "производство"])

@app.get("/api/procurement")
def get_procurement():
    sheets = load_xlsx_sheets()
    print("📋 Все листы:", list(sheets.keys()))
    result = find_sheet(sheets, ["procurement", "закупки"])
    print(f"📋 procurement: {len(result)} строк")
    if result:
        print(f"📋 Первая строка procurement: {result[0]}")
    return result

@app.get("/api/registry")
def get_registry():
    return find_sheet(load_xlsx_sheets(), ["registry", "реестр"])

@app.get("/api/stavka")
def get_stavka():
    return find_sheet(load_xlsx_sheets(), ["stavka", "ставка"])

@app.get("/")
def root():
    return {"status": "ok", "sheets": list(load_xlsx_sheets().keys())}

# ============================================================
# ЗАПУСК
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)