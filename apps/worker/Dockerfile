FROM node:20-alpine AS base
WORKDIR /app/apps/worker
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
COPY apps/worker/package.json ./
COPY tsconfig.base.json /app/tsconfig.base.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY apps/worker .
COPY --from=deps /app/apps/worker/node_modules ./node_modules
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app/apps/worker
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY --from=build /app/apps/worker/dist ./dist
COPY apps/worker/package.json ./
RUN pnpm install --prod --frozen-lockfile=false
CMD ["pnpm", "start"]
