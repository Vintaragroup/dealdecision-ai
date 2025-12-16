FROM node:20-alpine AS base
WORKDIR /app/apps/api
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
COPY apps/api/package.json ./
COPY tsconfig.base.json /app/tsconfig.base.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY apps/api .
COPY --from=deps /app/apps/api/node_modules ./node_modules
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app/apps/api
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY --from=build /app/apps/api/dist ./dist
COPY apps/api/package.json ./
RUN pnpm install --prod --frozen-lockfile=false
EXPOSE 9000
CMD ["pnpm", "start"]
