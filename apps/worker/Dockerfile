FROM node:20-bookworm-slim AS base
WORKDIR /app

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
RUN corepack prepare pnpm@10.28.1 --activate

# ----------------------
# deps: install workspace deps
# ----------------------
FROM base AS deps

# Skip Playwright's postinstall browser download — we install it explicitly below.
# PLAYWRIGHT_BROWSERS_PATH pins the location to a known path for the COPY below.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy workspace metadata first (improves cache + enables workspace resolution)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy workspace packages + worker sources so `workspace:*` deps resolve
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY artifacts ./artifacts

RUN pnpm install --frozen-lockfile

# Ensure the worker workspace deps are materialized for runtime resolution.
# Use an explicit filter to force dependency linking for the worker importer.
RUN pnpm --filter ./apps/worker... install --frozen-lockfile

# Sanity check: BullMQ must be resolvable from the worker package root.
# NOTE: `node -e` resolves modules relative to `/app/[eval]` (not `process.cwd()`),
# so we must use a require rooted at the worker package.
RUN node -e 'const { createRequire } = require("module"); const req = createRequire("/app/apps/worker/package.json"); req("bullmq"); console.log("bullmq_ok")'

# Download Playwright Chromium browser explicitly.
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD suppressed the postinstall hook above;
# this single explicit install writes the binary to PLAYWRIGHT_BROWSERS_PATH.
# Use pnpm exec so pnpm resolves the binary correctly without invoking
# it via `node` (which fails because .bin entries are shell scripts, not JS).
RUN cd /app/apps/worker && pnpm exec playwright install chromium

# ----------------------
# build: compile worker
# ----------------------
FROM deps AS build

RUN pnpm -r --filter @dealdecision/contracts build
RUN pnpm -r --filter @dealdecision/core build

WORKDIR /app/apps/worker
RUN pnpm run build

# ----------------------
# runner: production image
# ----------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app/apps/worker

ENV NODE_ENV=production

# System tools for document processing parity:
# - LibreOffice: Office -> PDF conversion (`soffice`)
# - Poppler: PDF inspection/rasterization helpers (pdfinfo/pdftoppm)
# - Ghostscript: PDF compatibility edge cases
# - ImageMagick: image transforms
# - Tesseract: OCR (binary; some flows may prefer it)
# - Fonts: rendering fidelity
# Playwright/Chromium runtime OS dependencies (pre-installed so that
# `playwright install chromium` below can run without --with-deps,
# avoiding a second brittle apt-get update inside the playwright CLI).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		libreoffice \
		poppler-utils \
		ghostscript \
		imagemagick \
		tesseract-ocr \
		tesseract-ocr-eng \
		fonts-dejavu-core \
		fonts-liberation \
		fonts-noto-core \
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
		libasound2 \
		libpango-1.0-0 \
		libcairo2 \
		libx11-xcb1 \
		libx11-6 \
		libxcb1 \
		libxext6 \
		libxshmfence1 \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/apps/worker/package.json ./package.json
COPY --from=deps /app/artifacts /app/artifacts
COPY --from=deps /app/artifacts ./artifacts

# pnpm workspace runtime deps (symlinks + .pnpm store live under /app/node_modules)
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/worker/node_modules ./node_modules
COPY --from=build /app/packages /app/packages

# Copy pre-downloaded Chromium browser from the deps stage.
# No network access required here — browser was fetched during the deps layer.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=deps /ms-playwright /ms-playwright

CMD ["node", "dist/src/index.js"]
