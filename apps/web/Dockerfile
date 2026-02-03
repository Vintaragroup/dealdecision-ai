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

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy workspace packages + web sources so `workspace:*` deps resolve
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile

# ----------------------
# build: compile web
# ----------------------
FROM deps AS build

# Build-time values baked into the Vite bundle.
ARG VITE_API_BASE_URL=http://localhost:9001
ARG VITE_BACKEND_MODE=live
ARG VITE_CLERK_PUBLISHABLE_KEY=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_BACKEND_MODE=$VITE_BACKEND_MODE
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

WORKDIR /app/apps/web
RUN pnpm run build

# ----------------------
# runner: production image
# ----------------------
FROM node:20-alpine AS runner
WORKDIR /app/apps/web

ENV NODE_ENV=production

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
RUN corepack prepare pnpm@10.28.1 --activate

COPY --from=build /app/apps/web/build ./build
COPY --from=build /app/apps/web/package.json ./package.json

# pnpm workspace runtime deps
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/web/node_modules ./node_modules

EXPOSE 4173
CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "4173", "--outDir", "build"]
