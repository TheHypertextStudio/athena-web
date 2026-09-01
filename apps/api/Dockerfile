# Default matches `.node-version`, which CI passes explicitly as this build arg.
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Corepack stopped shipping in Node 25. Install the compatible shim explicitly, then let the
# root packageManager field select the repository-pinned pnpm release.
RUN npm install --global corepack@0.35.0 && corepack enable pnpm

# Prune the monorepo to @docket/api + its workspace deps. `out/json` is just manifests + lockfile;
# `out/full` is the pruned source. Splitting them lets the dependency-install layer stay cached
# across source-only edits (only a manifest/lockfile change rebuilds it).
FROM base AS pruner
WORKDIR /app
COPY . .
# Pruned with the turbo this repository pins, read from the root manifest, so the pruner
# can never be a different release from the one that wrote the turbo.json it parses.
RUN pnpm dlx turbo@"$(node -p "require('./package.json').devDependencies.turbo")" prune @docket/api --docker

FROM base AS installer
WORKDIR /app
# Install from the pruned manifests first — this RUN is the cache-stable layer.
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/scripts/install-git-guardrails.sh ./scripts/install-git-guardrails.sh
RUN pnpm install --prod --frozen-lockfile
# Then the pruned source, retained for package assets and operator diagnostics. The serving process
# uses only the build-stage artifacts copied below.
COPY --from=pruner /app/out/full/ .

# Production receives already-runnable JavaScript. `tsx` is a development tool; loading it in the
# serving process starts an esbuild child during every cold start and turns a compiler failure into
# an API outage before Cloud Run can open the listener.
FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/scripts/install-git-guardrails.sh ./scripts/install-git-guardrails.sh
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @docket/api build:runtime

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=installer /app .
COPY --from=builder /app/apps/api/dist/server.mjs /app/apps/api/dist/server.mjs
COPY --from=builder /app/apps/api/dist/server.mjs.map /app/apps/api/dist/server.mjs.map
COPY --from=builder /app/packages/db/dist/migrate.mjs /app/packages/db/dist/migrate.mjs
COPY --from=builder /app/packages/db/dist/migrate.mjs.map /app/packages/db/dist/migrate.mjs.map
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["node", "dist/server.mjs"]
