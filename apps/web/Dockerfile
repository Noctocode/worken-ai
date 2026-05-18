# syntax=docker/dockerfile:1.7

# ---------- base ----------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY packages/database packages/database
COPY apps/web apps/web

# NEXT_PUBLIC_* values are baked at build time. Pass them through as build args
# from CI; safe values default to empty strings.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter web build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN groupadd -r app && useradd -r -g app -m -d /home/app app

# Next.js standalone output already bundles its own minimal node_modules.
# Layout (per next.config.ts output:'standalone' with outputFileTracingRoot='../..'):
#   .next/standalone/                  <- the runnable workspace root
#     apps/web/server.js
#     apps/web/.next/...
#     node_modules/...
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

RUN chown -R app:app /app
USER app

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
