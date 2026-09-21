# Контракт API для фронтенда

Документ описывает, какие endpoint'ы (URL для запросов) нужны фронтенду `index.html`.

## Общие принципы

- **Формат ответа:** JSON.
- **Кодировка:** UTF-8.
- **Base URL:** `/api`.
- **HTTP-метод:** GET для всех endpoint'ов.
- **Обёртка ответа:** каждый ответ содержит поле `status`:
  - `"ok"` — успех,
  - `"error"` — ошибка, с полем `message`.

**Пример ошибки:**
```json
{ "status": "error", "message": "Product not found" }


---

## Endpoint'ы

### 1. `GET /api/parents`

**Возвращает ВСЕ Parent-товары из базы** (весь список, не по одному).

Используется для:
- поиска и автодополнения,
- отображения полного списка товаров на главной,
- навигации по дереву.

**Параметры (опционально):**
- `limit` (по умолчанию 10000) — сколько записей вернуть,
- `offset` (по умолчанию 0) — с какой записи начать.

**Важно:** endpoint должен вернуть **все товары**, а не только первые 100.  
Если товаров >10000, использовать пагинацию.

**Ответ:**
```json
{
  "status": "ok",
  "total": 3025+,
  "items": [
    { "code": "4203100001", "name": "Мужское пальто из кожи" },
    { "code": "4107911000", "name": "Кожа из шкур КРС" },
    { "code": "4101201000", "name": "Необработанные шкуры КРС" }
  ]
}
}

### 2. GET /api/product/{code}

Полный профиль товара: метрики, дерево, таблицы, рейтинг.
Параметры: 
code — код ТН ВЭД (например, 4203100001).

**Ответ:**
```json
{
  "status": "ok",
  "code": "4203100001",
  "name": "Мужское пальто из кожи",
  "metrics": {
    "importUSD": 0,
    "exportUSD": 578754,
    "prodUSD": 578875,
    "market": 121,
    "importDependency": 0.0,
    "localizationIndex": 0.99,
    "producerCount": 6
  },
  "tree": [
    { "level": 0, "code": "4203100001", "name": "Мужское пальто" },
    { "level": 1, "code": "4107911000", "name": "Кожа из шкур КРС" },
    { "level": 2, "code": "4101201000", "name": "Необработанные шкуры" }
  ],
  "imports": [
    { "company": "ООО X", "costUSD": 1000 }
  ],
  "exports": [
    { "company": "ООО Y", "costUSD": 2000 }
  ],
  "manufacturers": [
    { "name": "BRANDO MANIA", "volume": 578875, "inn": "311382975" }
  ],
  "suppliers": [
    { "name": "Поставщик 1", "country": "TR", "totalPrice": 5000, "currency": "USD" }
  ]
}

### 3. GET /api/top-products

Рейтинг приоритетных товаров.
Параметры: 
limit (по умолчанию 100) — сколько записей вернуть.

**Ответ:**
```json
{
  "status": "ok",
  "items": [
    {
      "rank": 1,
      "code": "6109100000",
      "name": "Футболки трикотажные",
      "priorityScore": 87,
      "market": 123456,
      "importDependency": 0.95,
      "localizationIndex": 0.05,
      "prodUSD": 10000
    }
  ]
}

### 4. GET /api/procurement

Топ продукции в госзакупках.
Параметры:
limit (по умолчанию 100),
filter — all / industrial / outside.

**Ответ:**
```json
{
  "status": "ok",
  "items": [
    {
      "code": "6109100000",
      "name": "Футболки",
      "totalPrice": 5000000,
      "currency": "UZS",
      "suppliersCount": 12,
      "industrialSuppliers": 8
    }
  ]
}

### 5. GET /api/tariff-inversion

Товары с тарифной инверсией (пошлина на сырьё выше, чем на готовый товар).
Параметры: 
limit (по умолчанию 100).

**Ответ:**
```json

{
  "status": "ok",
  "items": [
    {
      "code": "4203100001",
      "name": "Пальто кожаное",
      "rate": 10,
      "materialRate": 20,
      "excess": 10
    }
  ]
}

### 6. GET /api/currency-rate

Текущий курс валют. Нужен для переключения сум/USD на фронте.

**Ответ:**
```json

{
  "status": "ok",
  "UZS_per_USD": 12600,
  "updatedAt": "2026-09-21T12:00:00Z"
}

### 7. GET /api/search?q={query}

Поиск по кодам и наименованиям.

{
  "status": "ok",
  "items": [
    { "code": "4203100001", "name": "Мужское пальто из кожи" }
  ]
}



