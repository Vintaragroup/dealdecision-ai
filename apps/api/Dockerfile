# Workspace-aware Dockerfile (monorepo + pnpm workspaces)
# This fixes ERR_PNPM_WORKSPACE_PKG_NOT_FOUND during Docker builds on Render.

FROM node:20-alpine AS base
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

# Copy the API workspace package manifest + sources, plus workspace packages.
# NOTE: This intentionally includes the workspace so `workspace:*` deps resolve.
COPY packages ./packages
COPY apps/api ./apps/api

# Install all workspace dependencies deterministically
RUN pnpm install --frozen-lockfile

# ----------------------
# build: compile api
# ----------------------
FROM deps AS build

# Build workspace deps needed by the API at compile-time (types/exports)
RUN pnpm -r --filter @dealdecision/contracts build
RUN pnpm -r --filter @dealdecision/core build

WORKDIR /app/apps/api
RUN pnpm run build

# ----------------------
# runner: production image
# ----------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Ensure pnpm is available in the runtime image (Render Docker deploy does not run build commands).
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
RUN corepack prepare pnpm@10.28.1 --activate

# Workspace metadata is required for `pnpm --filter api ...` to work.
COPY pnpm-workspace.yaml package.json ./

# Copy built output + package metadata
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

# Startup script runs migrations then starts the server
COPY apps/api/start.sh ./apps/api/start.sh
RUN chmod +x ./apps/api/start.sh

# Migration runner uses TS sources + infra SQL migrations
COPY apps/api/scripts ./apps/api/scripts
COPY apps/api/src ./apps/api/src
COPY infra/migrations ./infra/migrations

# Copy installed node_modules (pnpm creates symlinks into root .pnpm dir)
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/api/node_modules /app/apps/api/node_modules

# Copy built workspace packages required at runtime (workspace-linked deps)
COPY --from=build /app/packages /app/packages

EXPOSE 9000
WORKDIR /app/apps/api
CMD ["./start.sh"]
