# API Design Guidelines

> **Version**: 1.0.0
> **Last Updated**: 2026-01-04

## Overview

This document defines the API design standards for Project Athena's REST API and MCP server.

## REST API Principles

### General Guidelines

1. **RESTful semantics** - Use HTTP methods correctly
2. **JSON everywhere** - Request and response bodies are JSON
3. **Consistent naming** - camelCase for JSON, kebab-case for URLs
4. **Versioning via headers** - `Accept: application/vnd.athena.v1+json`
5. **Comprehensive OpenAPI** - All endpoints documented

### HTTP Methods

| Method | Purpose | Idempotent | Safe |
|--------|---------|------------|------|
| GET | Retrieve resource(s) | Yes | Yes |
| POST | Create resource | No | No |
| PUT | Replace resource | Yes | No |
| PATCH | Partial update | Yes | No |
| DELETE | Remove resource | Yes | No |

### URL Structure

```
/api/{resource}                    # Collection
/api/{resource}/{id}               # Single resource
/api/{resource}/{id}/{sub-resource}  # Nested resource
/api/{resource}?{query}            # Filtered collection
```

**Examples:**
```
GET    /api/tasks                  # List tasks
POST   /api/tasks                  # Create task
GET    /api/tasks/123              # Get task
PATCH  /api/tasks/123              # Update task
DELETE /api/tasks/123              # Delete task
GET    /api/projects/456/tasks     # List tasks in project
```

### Query Parameters

| Parameter | Purpose | Example |
|-----------|---------|---------|
| `limit` | Page size | `?limit=20` |
| `offset` | Pagination offset | `?offset=40` |
| `sort` | Sort field(s) | `?sort=-createdAt` |
| `filter` | Field filtering | `?filter[status]=active` |
| `include` | Related resources | `?include=project,tags` |

**Sorting:**
- Prefix with `-` for descending: `?sort=-createdAt`
- Multiple fields: `?sort=-priority,createdAt`

**Filtering:**
```
?filter[status]=active
?filter[priority]=high,medium
?filter[createdAt][gte]=2026-01-01
```

## Request/Response Format

### Request Headers

```http
Content-Type: application/json
Accept: application/vnd.athena.v1+json
Authorization: Bearer {token}
X-Request-ID: {uuid}
```

### Successful Responses

**Single Resource (200 OK):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "type": "task",
    "attributes": {
      "title": "Implement authentication",
      "status": "in_progress",
      "priority": "high",
      "createdAt": "2026-01-04T10:30:00Z",
      "updatedAt": "2026-01-04T10:30:00Z"
    },
    "relationships": {
      "project": {
        "data": { "type": "project", "id": "456" }
      }
    }
  }
}
```

**Collection (200 OK):**
```json
{
  "data": [
    { "id": "1", "type": "task", "attributes": { ... } },
    { "id": "2", "type": "task", "attributes": { ... } }
  ],
  "meta": {
    "total": 42,
    "limit": 20,
    "offset": 0
  },
  "links": {
    "self": "/api/tasks?limit=20&offset=0",
    "next": "/api/tasks?limit=20&offset=20",
    "last": "/api/tasks?limit=20&offset=40"
  }
}
```

**Created Resource (201 Created):**
```json
{
  "data": {
    "id": "789",
    "type": "task",
    "attributes": { ... }
  }
}
```

**No Content (204 No Content):**
- Used for successful DELETE operations
- Empty response body

### Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "title",
        "message": "Title is required"
      },
      {
        "field": "priority",
        "message": "Priority must be one of: low, medium, high"
      }
    ],
    "requestId": "abc123"
  }
}
```

### HTTP Status Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| 200 | OK | Successful GET, PATCH, PUT |
| 201 | Created | Successful POST |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid request body |
| 401 | Unauthorized | Missing/invalid auth |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource state conflict |
| 422 | Unprocessable Entity | Semantic validation error |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `AUTHENTICATION_REQUIRED` | 401 | No valid authentication |
| `INVALID_TOKEN` | 401 | Token expired or invalid |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource state conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Validation

### Input Validation

All endpoints validate input using Zod schemas:

```typescript
import { z } from 'zod';

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  projectId: z.string().uuid().optional(),
  deadline: z.string().datetime().optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
```

### Output Validation

Responses are also validated to prevent data leakage:

```typescript
export const TaskResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

## Authentication

### Token Format

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Token Claims

```json
{
  "sub": "user_123",
  "iat": 1704369600,
  "exp": 1704370500,
  "scope": ["read", "write"]
}
```

### Refresh Flow

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "rt_..."
}
```

## Rate Limiting

### Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704370000
```

### Rate Limit Response (429)

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retryAfter": 60
  }
}
```

## OpenAPI Documentation

All endpoints are documented using `@hono/zod-openapi`:

```typescript
import { createRoute, z } from '@hono/zod-openapi';

const createTaskRoute = createRoute({
  method: 'post',
  path: '/api/tasks',
  tags: ['Tasks'],
  summary: 'Create a new task',
  description: 'Creates a new task with the provided attributes.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTaskSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Task created successfully',
      content: {
        'application/json': {
          schema: TaskResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});
```

## MCP Server Design

### Transport

- **Protocol**: Streamable HTTP (HTTPS only)
- **Authentication**: OAuth 2.1 with PKCE

### Available Tools

| Tool | Description |
|------|-------------|
| `get_user_agenda` | Get agenda for a date |
| `get_activities` | Get user activities |
| `schedule_event` | Create calendar event |
| `create_project` | Create new project |
| `create_initiative` | Create new initiative |

### Tool Definition Example

```typescript
{
  name: 'get_user_agenda',
  description: 'Retrieves the agenda for the currently authenticated user',
  inputSchema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        format: 'date',
        description: 'The date to get the agenda for (YYYY-MM-DD)'
      }
    }
  }
}
```

### Resource URIs

```
tasks://                    # All tasks
tasks://{id}                # Single task
projects://                 # All projects
projects://{id}             # Single project
initiatives://              # All initiatives
initiatives://{id}          # Single initiative
events://                   # All events
events://{id}               # Single event
activities://               # All activities
```

### Elicitations

When additional user input is needed:

```json
{
  "type": "elicitation",
  "message": "Please provide more details about the event",
  "schema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "Where will this event take place?"
      },
      "attendees": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Who should be invited?"
      }
    }
  }
}
```

---

*See also: [Architecture](./architecture.md), [Tech Stack](./tech-stack.md)*
