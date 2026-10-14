# -*- coding: utf-8 -*-
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import openpyxl

app = FastAPI(title="Karta kooperacii API", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent.parent
EXCEL_FILE = BASE_DIR / "connection.xlsx"
DATA_DIR = BASE_DIR / "data"
RATE = 12600

_SHEETS_CACHE = None

def load_xlsx_sheets():
    global _SHEETS_CACHE
    if _SHEETS_CACHE is not None:
        return _SHEETS_CACHE
    if not EXCEL_FILE.exists():
        print("EXCEL NOT FOUND:", EXCEL_FILE)
        _SHEETS_CACHE = {}
        return _SHEETS_CACHE
    wb = openpyxl.load_workbook(EXCEL_FILE, read_only=True, data_only=True)
    result = {}
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.values)
        if not rows:
            result[sheet_name] = []
            continue
        headers = [f"col_{i}" if h is None else str(h).strip() for i, h in enumerate(rows[0])]
        data = []
        for row in rows[1:]:
            if all(v is None for v in row):
                continue
            data.append({headers[i]: row[i] for i in range(len(headers)) if i < len(row)})
        result[sheet_name] = data
    _SHEETS_CACHE = result
    return result

def find_sheet(sheets, aliases):
    for name in sheets.keys():
        if name.strip().lower() in [a.lower() for a in aliases]:
            return sheets[name]
    for name in sheets.keys():
        norm = name.strip().lower()
        for alias in aliases:
            if alias.lower() in norm:
                return sheets[name]
    return []

@app.get("/api/connection")
def get_connection():
    return find_sheet(load_xlsx_sheets(), ["connection"])

@app.get("/api/import")
@app.get("/api/imp")
def get_import():
    return find_sheet(load_xlsx_sheets(), ["import"])

@app.get("/api/export")
@app.get("/api/exp")
def get_export():
    return find_sheet(load_xlsx_sheets(), ["export"])

@app.get("/api/production")
@app.get("/api/prom")
def get_production():
    return find_sheet(load_xlsx_sheets(), ["prom", "production", "manufacture"])

@app.get("/api/procurement")
def get_procurement():
    return find_sheet(load_xlsx_sheets(), ["procurement"])

@app.get("/api/registry")
def get_registry():
    return find_sheet(load_xlsx_sheets(), ["registry"])

@app.get("/api/stavka")
def get_stavka():
    return find_sheet(load_xlsx_sheets(), ["stavka"])

@app.get("/api/health")
def health():
    sheets = load_xlsx_sheets()
    return {"status": "ok", "sheets": {name: len(rows) for name, rows in sheets.items()}}

frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)