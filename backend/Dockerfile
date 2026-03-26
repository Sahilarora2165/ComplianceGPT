FROM python:3.13-slim

WORKDIR /app

# -----------------------------
# 1. System dependencies (single clean layer)
# -----------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    poppler-utils \
    tesseract-ocr \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------
# 2. Python deps (cache optimized)
# -----------------------------
COPY requirements.txt .

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# -----------------------------
# 3. Playwright (single layer)
# -----------------------------
RUN pip install --no-cache-dir playwright && \
    playwright install chromium


# -----------------------------
# 4. Pre-download embedding model (cached)
# -----------------------------
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# -----------------------------
# 5. Copy app code (AFTER deps)
# -----------------------------
COPY . .


# -----------------------------
# 7. Health check (production)
# -----------------------------
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# -----------------------------
# 8. Runtime
# -----------------------------
EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]