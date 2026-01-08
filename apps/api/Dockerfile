# Athena API Dockerfile
# Multi-stage build for production deployment

# ============================================================================
# Stage 1: Base image with pnpm
# ============================================================================
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
WORKDIR /app

# ============================================================================
# Stage 2: Install dependencies
# ============================================================================
FROM base AS deps
# Copy workspace configuration files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/types/package.json ./packages/types/
COPY packages/test-utils/package.json ./packages/test-utils/

# Install production dependencies only
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# ============================================================================
# Stage 3: Build the application
# ============================================================================
FROM base AS builder
# Copy workspace configuration files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY apps/api/ ./apps/api/
COPY packages/shared/ ./packages/shared/
COPY packages/types/ ./packages/types/
COPY packages/test-utils/package.json ./packages/test-utils/

# Install all dependencies (including dev) for building
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build shared packages first, then API
WORKDIR /app/packages/types
RUN pnpm build
WORKDIR /app/packages/shared
RUN pnpm build
WORKDIR /app/apps/api
RUN pnpm build

# ============================================================================
# Stage 4: Production image
# ============================================================================
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 athena

# Copy only production dependencies and built files
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules

# Copy built files
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/

# Copy workspace config for module resolution
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

# Set ownership
RUN chown -R athena:nodejs /app

USER athena

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Run the application
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
