FROM python:3.11-slim

WORKDIR /app

# Keep image small and deterministic
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# OCR support (pytesseract requires the tesseract binary)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Fail fast during build if core imports are broken.
RUN python -c "import fastapi, uvicorn, numpy; import PIL; import cv2; from app.main import app; print('imports_ok')"

EXPOSE 8000

# Container is healthy when /health returns HTTP 200.
HEALTHCHECK --interval=10s --timeout=2s --retries=6 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=1).read()" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
