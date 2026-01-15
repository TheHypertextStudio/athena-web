# Runbooks

Step-by-step operational procedures for common tasks.

## Available Runbooks

| Runbook           | Description                                           |
| ----------------- | ----------------------------------------------------- |
| [Auth](./auth.md) | Authentication operations (OAuth, sessions, security) |

## What Belongs Here

Runbooks are **prescriptive procedures** - they tell you exactly what to do, step by step. They're written for operations, not development.

**Good runbook material:**

- Credential rotation procedures
- Incident response (force sign-out, block account)
- Database migrations with rollback steps
- System recovery procedures

**Not runbook material:**

- Conceptual explanations (put in `/docs/engineering/`)
- Troubleshooting guides (put in the relevant engineering doc)
- Development setup (put in `/docs/engineering/deployment.md`)

## Adding New Runbooks

1. Create `<domain>.md` in this directory
2. Follow the format: one procedure per heading, clear step numbering
3. Include rollback/recovery steps where applicable
4. Link from the relevant engineering doc
