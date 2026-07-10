ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Corepack stopped shipping in Node 25. Install the compatible shim explicitly, then let the
# root packageManager field select the repository-pinned pnpm release.
RUN npm install --global corepack@0.35.0 && corepack enable pnpm

# Prune to @docket/admin + its workspace deps so the install layer is cache-stable across source edits.
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.9.18 prune @docket/admin --docker

FROM base AS builder
WORKDIR /app
# Install from pruned manifests (cache-stable), then bring in the pruned source.
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/scripts/install-git-guardrails.sh ./scripts/install-git-guardrails.sh
RUN pnpm install --no-frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG API_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ENV API_URL=$API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NODE_ENV=production
ENV APP_MODE=production
RUN pnpm --filter=@docket/admin build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder /app/apps/admin/public ./apps/admin/public
EXPOSE 8080
ENV PORT=8080
CMD ["node", "apps/admin/server.js"]
