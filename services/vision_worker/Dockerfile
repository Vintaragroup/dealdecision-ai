FROM python:3.11-slim

WORKDIR /app

# Keep image small and deterministic
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# OCR + PDF/image tooling (pytesseract requires the tesseract binary)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        poppler-utils \
        ghostscript \
        imagemagick \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Optional: install local vision understanding deps (open_clip + torch)
ARG ENABLE_VISION_UNDERSTANDING=0
COPY requirements-vision.txt ./
RUN if [ "$ENABLE_VISION_UNDERSTANDING" = "1" ]; then pip install --no-cache-dir -r requirements-vision.txt; fi

COPY app ./app

# Fail fast during build if core imports are broken.
RUN python -c "import fastapi, uvicorn, numpy; import PIL; import cv2; from app.main import app; print('imports_ok')"

EXPOSE 8000

# Container is healthy when /health returns HTTP 200.
HEALTHCHECK --interval=10s --timeout=2s --retries=6 CMD python -c "import os, urllib.request; p=os.getenv('PORT','8000'); urllib.request.urlopen(f'http://127.0.0.1:{p}/health', timeout=1).read()" || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
