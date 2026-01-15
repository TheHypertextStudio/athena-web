# API Server Deployment Guide

> **Version**: 1.0.0
> **Last Updated**: 2026-01-05

This guide covers deploying the Project Athena API server from local development through production deployment.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [Environment Configuration](#environment-configuration)
4. [Database Setup](#database-setup)
5. [Running the Server](#running-the-server)
6. [Production Deployment](#production-deployment)
7. [Health Checks & Monitoring](#health-checks--monitoring)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

| Software   | Version   | Purpose                      |
| ---------- | --------- | ---------------------------- |
| Node.js    | >= 20.0.0 | JavaScript runtime           |
| pnpm       | >= 9.0.0  | Package manager              |
| PostgreSQL | >= 15     | Primary database             |
| Docker     | Latest    | Local development (optional) |

### Verify Installation

```bash
node --version    # Should be >= 20.0.0
pnpm --version    # Should be >= 9.0.0
docker --version  # Optional, for containerized PostgreSQL
```

---

## Local Development Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/hypertext-studio/athena-service.git
cd athena-service

# Install all dependencies
pnpm install

# Build shared packages
pnpm build
```

### 2. Set Up PostgreSQL

**Option A: Using Docker (Recommended)**

```bash
# Start PostgreSQL container
docker run -d \
  --name athena-postgres \
  -e POSTGRES_USER=athena \
  -e POSTGRES_PASSWORD=athena_dev_password \
  -e POSTGRES_DB=athena_dev \
  -p 5432:5432 \
  postgres:16-alpine

# Verify it's running
docker ps | grep athena-postgres
```

**Option B: Native PostgreSQL**

```bash
# macOS with Homebrew
brew install postgresql@16
brew services start postgresql@16

# Create database and user
psql postgres <<EOF
CREATE USER athena WITH PASSWORD 'athena_dev_password';
CREATE DATABASE athena_dev OWNER athena;
GRANT ALL PRIVILEGES ON DATABASE athena_dev TO athena;
EOF
```

### 3. Configure Environment

```bash
# Navigate to API package
cd apps/api

# Copy example environment file
cp .env.example .env

# Edit .env with your values (see Environment Configuration below)
```

### 4. Initialize Database

```bash
# Generate Drizzle migrations
pnpm db:generate

# Push schema to database
pnpm db:push
```

### 5. Start Development Server

```bash
# From apps/api directory
pnpm dev

# Or from repository root
pnpm --filter @athena/api dev
```

The API server will be available at `http://localhost:4000`.

---

## Environment Configuration

### Required Variables

These must be set for the server to start:

| Variable             | Description                    | Example                                                  |
| -------------------- | ------------------------------ | -------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string   | `postgresql://athena:password@localhost:5432/athena_dev` |
| `BETTER_AUTH_SECRET` | Auth secret (min 32 chars)     | Generate with `openssl rand -base64 32`                  |
| `BETTER_AUTH_URL`    | Frontend URL (where auth runs) | `http://localhost:3000`                                  |

### Minimal .env for Development

```env
NODE_ENV=development
PORT=4000
LOG_LEVEL=debug

DATABASE_URL=postgresql://athena:athena_dev_password@localhost:5432/athena_dev

BETTER_AUTH_SECRET=development-secret-key-at-least-32-chars
BETTER_AUTH_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

### Feature-Specific Configuration

#### OAuth Providers (Social Login)

```env
# Google
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Microsoft
MICROSOFT_CLIENT_ID=your-azure-app-id
MICROSOFT_CLIENT_SECRET=your-azure-secret

# Apple
APPLE_CLIENT_ID=com.yourapp.service
APPLE_CLIENT_SECRET=your-apple-key
```

**Setup Links:**

- Google: [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- Microsoft: [Azure Portal](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps)
- Apple: [Apple Developer](https://developer.apple.com/account/resources/authkeys)

#### Calendar Sync

```env
# Google Calendar (uses OAuth credentials above)
# Enable Calendar API in Google Cloud Console

# Outlook Calendar
OUTLOOK_CLIENT_ID=your-outlook-client-id
OUTLOOK_CLIENT_SECRET=your-outlook-secret
OUTLOOK_REDIRECT_URI=http://localhost:3000/settings/integrations/callback
```

#### AI Assistant (Athena)

```env
# OpenAI (GPT-4, GPT-3.5)
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=org-...  # Optional

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Default provider
AI_DEFAULT_PROVIDER=openai  # or anthropic
```

#### Email Notifications

```env
# Using Resend (recommended)
EMAIL_PROVIDER=resend
EMAIL_API_KEY=re_...
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
EMAIL_FROM_NAME=Project Athena

# Using SMTP
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

#### File Storage

```env
# Local storage (development)
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=./uploads

# S3-compatible storage (production)
STORAGE_PROVIDER=s3
S3_BUCKET=athena-uploads
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=  # For non-AWS (MinIO, GCS, etc.)
STORAGE_PUBLIC_URL_BASE=https://cdn.yourdomain.com
```

#### Billing (Stripe)

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
```

---

## Database Setup

### Schema Management

```bash
# Generate migration from schema changes
pnpm db:generate

# Apply migrations to database
pnpm db:migrate

# Push schema directly (development only)
pnpm db:push

# Open Drizzle Studio (database browser)
pnpm db:studio
```

### Database Schema

The API uses Drizzle ORM with the following core tables:

- `users` - User accounts
- `sessions` - Authentication sessions
- `tasks` - Task items
- `projects` - Project containers
- `initiatives` - High-level initiatives
- `events` - Calendar events
- `activities` - Activity tracking
- `notifications` - Notification records

### Backup and Restore

```bash
# Backup
pg_dump $DATABASE_URL > backup.sql

# Restore
psql $DATABASE_URL < backup.sql
```

---

## Running the Server

### Development Mode

```bash
# Hot-reload development server
pnpm dev
```

### Production Mode

```bash
# Build TypeScript
pnpm build

# Start production server
pnpm start
```

### Available Scripts

| Script           | Description                              |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Start development server with hot reload |
| `pnpm build`     | Compile TypeScript to JavaScript         |
| `pnpm start`     | Run compiled production server           |
| `pnpm test`      | Run test suite                           |
| `pnpm typecheck` | Check TypeScript types                   |
| `pnpm lint`      | Run ESLint                               |
| `pnpm db:studio` | Open Drizzle Studio                      |

---

## Production Deployment

### Docker Deployment

**Dockerfile** (in `apps/api/`):

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @athena/api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json .
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 4000
CMD ["node", "dist/index.js"]
```

**Build and Run:**

```bash
# Build image
docker build -t athena-api -f apps/api/Dockerfile .

# Run container
docker run -d \
  --name athena-api \
  -p 4000:4000 \
  --env-file apps/api/.env \
  athena-api
```

### Google Cloud Run

```bash
# Build and push to Container Registry
gcloud builds submit --tag gcr.io/PROJECT_ID/athena-api

# Deploy to Cloud Run
gcloud run deploy athena-api \
  --image gcr.io/PROJECT_ID/athena-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "DATABASE_URL=athena-db-url:latest,BETTER_AUTH_SECRET=auth-secret:latest"
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use production database (Cloud SQL, RDS, etc.)
- [ ] Generate strong `BETTER_AUTH_SECRET`
- [ ] Configure HTTPS/TLS
- [ ] Set up database backups
- [ ] Configure logging (Sentry, Cloud Logging)
- [ ] Set appropriate rate limits
- [ ] Enable CORS for production frontend domain
- [ ] Configure CDN for static assets
- [ ] Set up health check monitoring

### MCP Endpoint

- Production MCP endpoint: `https://athena.hypertext.studio/mcp`
- All MCP requests are handled at `/mcp` (no subroutes).

---

## Health Checks & Monitoring

### Health Endpoints

| Endpoint            | Description                         |
| ------------------- | ----------------------------------- |
| `GET /health`       | Basic health check (returns 200 OK) |
| `GET /health/ready` | Readiness check (includes database) |

### Example Health Check Response

```json
{
  "status": "healthy",
  "timestamp": "2026-01-05T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 3600
}
```

### Logging

The API uses Pino for structured JSON logging:

```bash
# Development (pretty-printed)
LOG_LEVEL=debug pnpm dev

# Production (JSON)
LOG_LEVEL=info pnpm start
```

Log levels: `debug` < `info` < `warn` < `error`

### Metrics

For production monitoring, integrate with:

- **Google Cloud Monitoring** - Built-in for Cloud Run
- **Sentry** - Error tracking (`SENTRY_DSN`)
- **Custom metrics** - Via `/metrics` endpoint (if enabled)

---

## Troubleshooting

### Common Issues

#### Database Connection Failed

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solutions:**

1. Ensure PostgreSQL is running: `docker ps` or `pg_isready`
2. Check `DATABASE_URL` format
3. Verify firewall/network settings

#### Authentication Secret Too Short

```
Error: Environment validation failed:
  BETTER_AUTH_SECRET: String must contain at least 32 character(s)
```

**Solution:** Generate a proper secret:

```bash
openssl rand -base64 32
```

#### CORS Errors

```
Access-Control-Allow-Origin header missing
```

**Solution:** Set `FRONTEND_URL` to your frontend domain:

```env
FRONTEND_URL=https://app.yourdomain.com
```

#### Port Already in Use

```
Error: listen EADDRINUSE: address already in use :::4000
```

**Solution:** Use a different port or kill the existing process:

```bash
PORT=4001 pnpm dev
# or
lsof -ti:4000 | xargs kill
```

### Debug Mode

Enable verbose logging:

```bash
LOG_LEVEL=debug pnpm dev
```

### Database Issues

```bash
# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# Reset database (development only!)
pnpm db:push --force

# View current schema
pnpm db:studio
```

### Getting Help

- Check existing issues: [GitHub Issues](https://github.com/hypertext-studio/athena-service/issues)
- Review logs for error details
- Enable debug logging for more context

---

## Quick Reference

### Minimum Configuration

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://athena:password@localhost:5432/athena_dev
BETTER_AUTH_SECRET=your-32-character-minimum-secret-key
BETTER_AUTH_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

### Start Commands

```bash
# Development
pnpm dev

# Production
pnpm build && pnpm start

# Tests
pnpm test
```

### Useful URLs

| URL                              | Description                             |
| -------------------------------- | --------------------------------------- |
| `http://localhost:4000`          | API server                              |
| `http://localhost:4000/health`   | Health check                            |
| `http://localhost:4000/api/docs` | API documentation                       |
| `http://localhost:3000`          | Frontend (Next.js)                      |
| `http://localhost:4983`          | Drizzle Studio (after `pnpm db:studio`) |

---

_See also: [Architecture](./architecture.md), [API Design](./api-design.md), [Tech Stack](./tech-stack.md)_
