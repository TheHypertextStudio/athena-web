ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install --global corepack@0.35.0 && corepack enable

# Prune to @docket/web + its workspace deps so the install layer is cache-stable across source edits.
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.9.18 prune @docket/web --docker

FROM base AS builder
WORKDIR /app
# Install from pruned manifests (cache-stable), then bring in the pruned source.
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/scripts/install-git-guardrails.sh ./scripts/install-git-guardrails.sh
RUN pnpm install --no-frozen-lockfile
COPY --from=pruner /app/out/full/ .
# Build-time env: API_URL for next.config rewrites, NEXT_PUBLIC_* get inlined into the bundle
ARG API_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ENV API_URL=$API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NODE_ENV=production
ENV APP_MODE=production
RUN pnpm --filter=@docket/web build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# standalone output becomes the working directory root
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 8080
ENV PORT=8080
CMD ["node", "apps/web/server.js"]
