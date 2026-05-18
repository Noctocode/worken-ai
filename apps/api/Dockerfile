# syntax=docker/dockerfile:1.7

# ---------- base ----------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Native build deps (argon2, pg native bindings).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------- deps ----------
# Copy only manifests so this layer caches when source changes but deps don't.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY packages/database packages/database
COPY apps/api apps/api
# Build the @worken/database package (tsc -> ./dist).
RUN pnpm --filter @worken/database build
# Swap the database package.json to publish-style exports (dist instead of src)
# so the API's compiled output can `require('@worken/database/schema')` at runtime.
RUN node -e "const fs=require('fs');const p='packages/database/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.publishConfig){Object.assign(j,j.publishConfig);delete j.publishConfig;fs.writeFileSync(p,JSON.stringify(j,null,2));}"
# Build the API.
RUN pnpm --filter api build
# Drop dev deps so the runtime stage only ships prod modules.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app

# Non-root user.
RUN groupadd -r app && useradd -r -g app -m -d /home/app app

# Workspace layout — preserves pnpm symlinks for @worken/database.
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/database/package.json packages/database/package.json
COPY --from=build /app/packages/database/dist packages/database/dist
COPY --from=build /app/packages/database/migrations packages/database/migrations
COPY --from=build /app/packages/database/node_modules packages/database/node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/node_modules apps/api/node_modules

# Runtime upload dir (mounted as a volume by docker-compose).
RUN mkdir -p apps/api/uploads && chown -R app:app /app
USER app

EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
