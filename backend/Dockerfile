FROM python:3.11-slim

# Устанавливаем системные зависимости для сборки бинарных пакетов (bcrypt, и т.д.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Сначала копируем только requirements для кэширования слоев
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем остальной код
COPY . .

# Создаем директорию для загрузок, чтобы Docker не создал её от имени root позже
RUN mkdir -p app/uploads

# Открываем порт FastAPI
EXPOSE 8000

# Запуск через uvicorn (имя файла main.py, объект app)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
