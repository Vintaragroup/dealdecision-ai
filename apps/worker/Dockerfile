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

# Needed for Office document rendering (pptx/docx/xlsx -> pdf) via `soffice`.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends libreoffice \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/apps/worker/package.json ./package.json

# pnpm workspace runtime deps (symlinks + .pnpm store live under /app/node_modules)
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/worker/node_modules ./node_modules
COPY --from=build /app/packages /app/packages

CMD ["node", "dist/src/index.js"]
