# System Architecture

> **Version**: 1.0.0
> **Last Updated**: 2026-01-04

## Overview

Project Athena is a multi-platform productivity platform built as a distributed system with a centralized API backend and multiple client applications.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                         │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│   Web App       │   iOS App       │   Android App   │   Third-Party Clients │
│   (Next.js)     │   (Swift)       │   (Kotlin)      │   (MCP Clients)       │
└────────┬────────┴────────┬────────┴────────┬────────┴──────────┬────────────┘
         │                 │                 │                   │
         │                 │                 │                   │
         ▼                 ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY (Cloud Run)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   REST API   │  │   MCP Server │  │  WebSockets  │  │   Webhooks   │    │
│  │   (Hono)     │  │  (Streamable)│  │  (Real-time) │  │  (External)  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└────────┬────────────────┬────────────────┬────────────────┬─────────────────┘
         │                │                │                │
         ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CORE SERVICES                                        │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│  Auth Service   │  Task Service   │  Calendar Svc   │  Assistant Service    │
│  (better-auth)  │                 │                 │  (Athena AI)          │
├─────────────────┴─────────────────┴─────────────────┴───────────────────────┤
│  Billing Service (Stripe)  │  Notification Service  │  Sync Service         │
└────────┬────────────────────────────┬────────────────────────┬──────────────┘
         │                            │                        │
         ▼                            ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                           │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│   PostgreSQL    │   Redis Cache   │   Cloud Storage │   Vector Store        │
│   (Primary)     │   (Sessions)    │   (Attachments) │   (Embeddings)        │
└─────────────────┴─────────────────┴─────────────────┴───────────────────────┘
```

## Monorepo Structure

```
athena-service/
├── packages/
│   ├── api/                    # Hono backend service
│   │   ├── src/
│   │   │   ├── routes/         # API route handlers
│   │   │   ├── services/       # Business logic
│   │   │   ├── middleware/     # Hono middleware
│   │   │   ├── db/             # Drizzle schema & migrations
│   │   │   └── lib/            # Utilities
│   │   └── package.json
│   │
│   ├── web/                    # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/            # App Router pages
│   │   │   ├── components/     # React components
│   │   │   ├── lib/            # Client utilities
│   │   │   └── styles/         # Global styles
│   │   └── package.json
│   │
│   ├── shared/                 # Shared utilities
│   │   ├── src/
│   │   │   ├── validation/     # Zod schemas
│   │   │   ├── constants/      # Shared constants
│   │   │   └── utils/          # Utility functions
│   │   └── package.json
│   │
│   ├── types/                  # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── api/            # API types
│   │   │   ├── domain/         # Domain model types
│   │   │   └── index.ts        # Type exports
│   │   └── package.json
│   │
│   └── test-utils/             # Testing utilities
│       ├── src/
│       │   ├── fixtures/       # Test fixtures
│       │   ├── mocks/          # Mock implementations
│       │   └── helpers/        # Test helpers
│       └── package.json
│
├── scripts/                    # Build and maintenance scripts
├── docs/                       # Documentation
├── turbo.json                  # Turborepo config
├── pnpm-workspace.yaml         # pnpm workspace config
└── package.json                # Root package.json
```

## Domain Model

### Core Entities

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DOMAIN MODEL                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐           ┌──────────────┐           ┌──────────────┐    │
│  │   INITIATIVE │──────────►│   PROJECT    │──────────►│    TASK      │    │
│  │              │ 1:N       │              │ 1:N       │              │    │
│  │  - id        │           │  - id        │           │  - id        │    │
│  │  - name      │           │  - name      │           │  - title     │    │
│  │  - status    │           │  - status    │           │  - status    │    │
│  │  - owner     │           │  - deadline  │           │  - deadline  │    │
│  └──────────────┘           └──────────────┘           │  - priority  │    │
│                                                         └───────┬──────┘    │
│                                                                 │            │
│  ┌──────────────┐           ┌──────────────┐                   │            │
│  │    EVENT     │           │   MOMENT     │◄──────────────────┘            │
│  │              │           │  (Time Box)  │ assigned to                    │
│  │  - id        │           │              │                                │
│  │  - title     │           │  - id        │                                │
│  │  - start     │           │  - start     │                                │
│  │  - end       │           │  - end       │                                │
│  │  - recurrence│           │  - label     │                                │
│  └──────────────┘           └──────────────┘                                │
│                                                                              │
│  ┌──────────────┐           ┌──────────────┐                                │
│  │   ACTIVITY   │──────────►│   STREAM     │                                │
│  │              │ belongs   │              │                                │
│  │  - id        │ to        │  - id        │                                │
│  │  - type      │           │  - name      │                                │
│  │  - start     │           │  - source    │                                │
│  │  - end       │           │  - owner     │                                │
│  │  - metadata  │           └──────────────┘                                │
│  └──────────────┘                                                           │
│                                                                              │
│  ┌──────────────┐                                                           │
│  │    AGENDA    │                                                           │
│  │              │                                                           │
│  │  - date      │  (Computed view of Tasks + Events for a day)              │
│  │  - tasks[]   │                                                           │
│  │  - events[]  │                                                           │
│  └──────────────┘                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Entity Relationships

| Relationship | Cardinality | Description |
|--------------|-------------|-------------|
| User → Initiative | 1:N | User owns many initiatives |
| Initiative → Project | 1:N | Initiative contains many projects |
| Project → Task | 1:N | Project contains many tasks |
| Task → Moment | N:1 | Task can be assigned to a time block |
| User → Activity Stream | 1:N | User owns many activity streams |
| Activity Stream → Activity | 1:N | Stream contains many activities |
| Event → User | N:M | Events can have multiple participants |

## API Design

### REST API Structure

```
/api/v1/
├── /auth/                     # Authentication endpoints
│   ├── POST /signin
│   ├── POST /signup
│   ├── POST /signout
│   └── POST /refresh
│
├── /users/                    # User management
│   ├── GET /me
│   └── PATCH /me
│
├── /tasks/                    # Task CRUD
│   ├── GET /
│   ├── POST /
│   ├── GET /:id
│   ├── PATCH /:id
│   └── DELETE /:id
│
├── /projects/                 # Project CRUD
│   └── ...
│
├── /initiatives/              # Initiative CRUD
│   └── ...
│
├── /events/                   # Calendar events
│   └── ...
│
├── /activities/               # Activity tracking
│   └── ...
│
├── /agenda/                   # Agenda views
│   └── GET /:date
│
├── /assistant/                # Athena AI
│   ├── POST /sessions
│   ├── POST /sessions/:id/messages
│   └── GET /sessions/:id/messages
│
└── /admin/                    # Admin endpoints
    └── ...
```

### API Versioning

API versioning is handled via the `Accept` header:

```
Accept: application/vnd.athena.v1+json
```

Default version is `v1` if no version header is provided.

## Authentication Flow

```
┌────────────┐      ┌────────────┐      ┌────────────┐      ┌────────────┐
│   Client   │      │  Athena API│      │ better-auth│      │   IdP      │
└─────┬──────┘      └─────┬──────┘      └─────┬──────┘      └─────┬──────┘
      │                   │                   │                   │
      │  1. Init OAuth    │                   │                   │
      │──────────────────►│                   │                   │
      │                   │  2. Create flow   │                   │
      │                   │──────────────────►│                   │
      │                   │                   │                   │
      │  3. Redirect URL  │                   │                   │
      │◄──────────────────│◄──────────────────│                   │
      │                   │                   │                   │
      │  4. Redirect to IdP                                       │
      │──────────────────────────────────────────────────────────►│
      │                                                           │
      │  5. User authenticates                                    │
      │◄──────────────────────────────────────────────────────────│
      │                   │                   │                   │
      │  6. Callback      │                   │                   │
      │──────────────────►│                   │                   │
      │                   │  7. Exchange code │                   │
      │                   │──────────────────►│──────────────────►│
      │                   │                   │◄──────────────────│
      │                   │◄──────────────────│                   │
      │                   │                   │                   │
      │  8. Session token │                   │                   │
      │◄──────────────────│                   │                   │
      │                   │                   │                   │
```

## MCP Server Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MCP SERVER (Streamable HTTP)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         TRANSPORT LAYER                              │   │
│  │                    (Streamable HTTP over HTTPS)                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         AUTHORIZATION                                │   │
│  │              OAuth 2.1 (PKCE) + Dynamic Client Registration          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│          ┌─────────────────────────┼─────────────────────────┐             │
│          ▼                         ▼                         ▼             │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐       │
│  │    TOOLS     │         │  RESOURCES   │         │  UTILITIES   │       │
│  ├──────────────┤         ├──────────────┤         ├──────────────┤       │
│  │get_user_agenda│        │   tasks://   │         │ cancellation │       │
│  │get_activities│         │  projects:// │         │    ping      │       │
│  │schedule_event│         │initiatives://│         │  progress    │       │
│  │create_project│         │  events://   │         │   logging    │       │
│  │create_initiative       │ activities://│         │ pagination   │       │
│  └──────────────┘         └──────────────┘         └──────────────┘       │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         ELICITATIONS                                 │   │
│  │              (User input requests for additional context)            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE CLOUD PLATFORM                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐                        │
│  │   Cloud Load        │    │    Cloud CDN        │                        │
│  │   Balancer          │    │    (Static Assets)  │                        │
│  └──────────┬──────────┘    └─────────────────────┘                        │
│             │                                                               │
│             ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         CLOUD RUN                                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │   │
│  │  │  API Service    │  │   Web Service   │  │  Worker Service │     │   │
│  │  │  (Hono)         │  │   (Next.js SSR) │  │  (Background)   │     │   │
│  │  │  min: 1         │  │   min: 1        │  │  min: 0         │     │   │
│  │  │  max: 100       │  │   max: 50       │  │  max: 10        │     │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         DATA SERVICES                                │   │
│  ├───────────────────┬─────────────────────┬───────────────────────────┤   │
│  │   Cloud SQL       │   Memorystore       │   Cloud Storage           │   │
│  │   (PostgreSQL)    │   (Redis)           │   (Attachments)           │   │
│  │   HA Replica      │   Standard          │   Multi-region            │   │
│  └───────────────────┴─────────────────────┴───────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         OBSERVABILITY                                │   │
│  ├───────────────────┬─────────────────────┬───────────────────────────┤   │
│  │   Cloud Logging   │   Sentry            │   Cloud Monitoring        │   │
│  │   (Logs)          │   (Errors)          │   (Metrics)               │   │
│  └───────────────────┴─────────────────────┴───────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Security Considerations

### Authentication & Authorization

- **OAuth 2.1 + PKCE** for all client authentication
- **WebAuthn/Passkeys** for passwordless authentication
- **JWT tokens** with short expiry (15 min) + refresh tokens
- **Row-level security** in PostgreSQL for multi-tenancy

### Data Protection

- **Encryption at rest** for all user data (optional, user-controlled)
- **TLS 1.3** for all network communication
- **Secrets management** via Google Secret Manager
- **No PII in logs** - structured logging with Pino

### API Security

- **Rate limiting** per user/IP
- **Input validation** via Zod on all endpoints
- **Output validation** to prevent data leakage
- **CORS configuration** for allowed origins only

---

*See also: [Tech Stack](./tech-stack.md), [API Design](./api-design.md)*
