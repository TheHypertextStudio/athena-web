ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install all workspace deps (pnpm deploy needs the full store to bundle workspace packages)
FROM base AS installer
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && \
    pnpm --filter=@docket/api deploy --legacy --prod /deploy

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=installer /deploy .
EXPOSE 8080
# node --import=tsx/esm is the correct ESM loader invocation for tsx v4+ on Node 18.19+
CMD ["node", "--import=tsx/esm", "src/server.ts"]
