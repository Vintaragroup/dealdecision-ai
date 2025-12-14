FROM node:20-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
COPY package.json ./
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY --from=build /app/build ./build
COPY package.json ./
RUN pnpm install --prod --frozen-lockfile=false
EXPOSE 4173
CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "4173"]
