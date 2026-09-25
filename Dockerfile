FROM python:3.11-slim

WORKDIR /app

# Копируем зависимости из папки backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь проект (index.html, connection.xlsx, data/ и т.д.)
COPY . .

EXPOSE 8000

# Запускаем приложение из папки backend
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]