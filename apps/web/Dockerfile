FROM node:20-alpine AS base
WORKDIR /app/apps/web
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:/app/apps/web/node_modules/.bin:$PATH
RUN corepack enable

FROM base AS deps
COPY apps/web/package.json ./
COPY tsconfig.base.json /app/tsconfig.base.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY apps/web .
COPY --from=deps /app/apps/web/node_modules ./node_modules
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app/apps/web
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:/app/apps/web/node_modules/.bin:$PATH
RUN corepack enable
COPY --from=build /app/apps/web/build ./build
COPY apps/web/package.json ./
COPY --from=deps /app/apps/web/node_modules ./node_modules
EXPOSE 4173
CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "4173", "--outDir", "build"]
