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

# Copy workspace metadata first (improves cache + enables workspace resolution)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy workspace packages + worker sources so `workspace:*` deps resolve
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile

# Sanity check: BullMQ must be available at worker runtime.
RUN node -e 'process.chdir("apps/worker"); require("bullmq"); console.log("bullmq_ok")'

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
	&& rm -rf /var/lib/apt/lists/*

COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/apps/worker/package.json ./package.json

# pnpm workspace runtime deps (symlinks + .pnpm store live under /app/node_modules)
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/worker/node_modules ./node_modules
COPY --from=build /app/packages /app/packages

CMD ["node", "dist/src/index.js"]
