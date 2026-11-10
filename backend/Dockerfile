FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY . .
RUN python scripts/import_starter_vocabulary.py && pip install --no-cache-dir ".[documents]"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
