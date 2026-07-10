ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install --global corepack@0.35.0 && corepack enable

# Prune the monorepo to @docket/api + its workspace deps. `out/json` is just manifests + lockfile;
# `out/full` is the pruned source. Splitting them lets the dependency-install layer stay cached
# across source-only edits (only a manifest/lockfile change rebuilds it).
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.9.18 prune @docket/api --docker

FROM base AS installer
WORKDIR /app
# Install from the pruned manifests first — this RUN is the cache-stable layer.
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/scripts/install-git-guardrails.sh ./scripts/install-git-guardrails.sh
RUN pnpm install --prod --no-frozen-lockfile
# Then the pruned source (api + the workspace packages it imports, run from TS via tsx).
COPY --from=pruner /app/out/full/ .

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=installer /app .
WORKDIR /app/apps/api
EXPOSE 8080
# node --import=tsx/esm is the correct ESM loader invocation for tsx v4+ on Node 18.19+
CMD ["node", "--import=tsx/esm", "src/server.ts"]
