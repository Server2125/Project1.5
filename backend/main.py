# ============================================================
#  КАРТА ПРОИЗВОДСТВЕННОЙ КООПЕРАЦИИ — BACKEND API
#  v2.0 — Исправлены дубликаты, добавлены алиасы эндпоинтов
#  Python 3.14, fastapi, openpyxl
# ============================================================

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import openpyxl
import math

# проверка автообновления

# ============================================================
# ИНИЦИАЛИЗАЦИЯ
# ============================================================
app = FastAPI(
    title="Карта кооперации API",
    version="2.0",
    description="API для платформы анализа импортозависимости"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent.parent
EXCEL_FILE = BASE_DIR / "connection.xlsx"   # ✅ корень/connection.xlsx
DATA_DIR   = BASE_DIR / "data"              # ✅ корень/data/

RATE = 12600  # сум / USD

print("=" * 60)
print("📂 BASE_DIR:", BASE_DIR)
print("📂 Excel:", EXCEL_FILE)
print("📂 CSV:  ", DATA_DIR)
print("=" * 60)

# ============================================================
# ЗАГРУЗКА И КЭШИРОВАНИЕ EXCEL
# ============================================================
_SHEETS_CACHE = None

def load_xlsx_sheets():
    """Читает все листы из connection.xlsx и кэширует их."""
    global _SHEETS_CACHE
    if _SHEETS_CACHE is not None:
        return _SHEETS_CACHE

    if not EXCEL_FILE.exists():
        print(f"❌ НЕ НАЙДЕН ФАЙЛ: {EXCEL_FILE}")
        _SHEETS_CACHE = {}
        return _SHEETS_CACHE

    print(f"📂 Читаю {EXCEL_FILE}...")
    wb = openpyxl.load_workbook(EXCEL_FILE, read_only=True, data_only=True)
    result = {}

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.values)
        if not rows:
            result[sheet_name] = []
            print(f"  ⚠ Лист '{sheet_name}': пустой")
            continue

        # Нормализуем заголовки
        headers = []
        for i, h in enumerate(rows[0]):
            if h is None:
                headers.append(f"col_{i}")
            else:
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
        print(f"  ✅ Лист '{sheet_name}': {len(data)} строк, колонок: {len(headers)}")

    print("📋 ВСЕ ЛИСТЫ:", list(result.keys()))
    _SHEETS_CACHE = result
    return result


def find_sheet(sheets: dict, aliases: list):
    """Ищет лист по имени (точное совпадение → частичное)."""
    # Точное
    for name in sheets.keys():
        if name.strip().lower() in [a.lower() for a in aliases]:
            return sheets[name]
    # Частичное
    for name in sheets.keys():
        norm = name.strip().lower()
        for alias in aliases:
            if alias.lower() in norm:
                return sheets[name]
    return []


# ============================================================
# ВСПОМОГАТЕЛЬНЫЕ
# ============================================================
def _num(v):
    if v is None:
        return 0.0
    s = str(v).replace(" ", "").replace("\u00A0", "").replace(",", ".").strip()
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0

def _code(v):
    if v is None:
        return ""
    return str(v).replace(".0", "").replace(" ", "").strip()

def _str(v):
    if v is None:
        return ""
    return str(v).strip()

def _find_col(df, variants):
    if df is None or df.empty:
        return None
    for v in variants:
        for c in df.columns:
            if str(c).strip().lower() == v.lower():
                return c
    for v in variants:
        for c in df.columns:
            if v.lower() in str(c).strip().lower():
                return c
    return None


# ============================================================
# ЭНДПОИНТЫ — CONNECTION (иерархия)
# ============================================================
@app.get("/api/connection")
def get_connection():
    return find_sheet(load_xlsx_sheets(), ["connection", "связи"])


# ============================================================
# ЭНДПОИНТЫ — IMPORT / IMP (алиасы!)
# ============================================================
@app.get("/api/import")
@app.get("/api/imp")
def get_import():
    return find_sheet(load_xlsx_sheets(), ["import", "импорт"])


# ============================================================
# ЭНДПОИНТЫ — EXPORT / EXP (алиасы!)
# ============================================================
@app.get("/api/export")
@app.get("/api/exp")
def get_export():
    return find_sheet(load_xlsx_sheets(), ["export", "экспорт"])


# ============================================================
# ЭНДПОИНТЫ — PRODUCTION / PROM (алиасы!)
# ============================================================
@app.get("/api/production")
@app.get("/api/prom")
def get_production():
    return find_sheet(load_xlsx_sheets(), ["prom", "production", "manufacture", "производство"])


# ============================================================
# ЭНДПОИНТ — PROCUREMENT (госзакупки)
# ============================================================
@app.get("/api/procurement")
def get_procurement():
    sheets = load_xlsx_sheets()
    result = find_sheet(sheets, ["procurement", "закупки", "закупка", "purchase", "госзакупки"])
    print(f"📋 /api/procurement → {len(result)} строк")
    if result:
        print(f"   Первая колонка: {list(result[0].keys())[:5]}")
    return result


# ============================================================
# ЭНДПОИНТ — REGISTRY (реестр предприятий)
# ============================================================
@app.get("/api/registry")
def get_registry():
    return find_sheet(load_xlsx_sheets(), ["registry", "реестр", "предприятия", "companies"])


# ============================================================
# ЭНДПОИНТ — STAVKA (тарифные ставки)
# ============================================================
@app.get("/api/stavka")
def get_stavka():
    return find_sheet(load_xlsx_sheets(), ["stavka", "ставка", "тариф", "ставки"])


# ============================================================
# HEALTH CHECK
# ============================================================
@app.get("/api/health")
def health():
    sheets = load_xlsx_sheets()
    return {
        "status": "ok",
        "sheets": {name: len(rows) for name, rows in sheets.items()},
    }


@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "API работает. Листы: " + ", ".join(load_xlsx_sheets().keys()),
        "endpoints": [
            "/api/connection",
            "/api/import  (или /api/imp)",
            "/api/export  (или /api/exp)",
            "/api/production  (или /api/prom)",
            "/api/procurement",
            "/api/registry",
            "/api/stavka",
            "/api/health",
        ],
    }


# ============================================================
# ЗАПУСК
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)