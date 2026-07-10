ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install --global corepack@0.35.0 && corepack enable

FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.9.18 prune @docket/db --docker

FROM base AS runner
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/scripts/install-git-guardrails.sh ./scripts/install-git-guardrails.sh
RUN pnpm install --no-frozen-lockfile
COPY --from=pruner /app/out/full/ .
CMD ["pnpm", "--filter", "@docket/db", "db:migrate"]
