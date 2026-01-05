# Implementation Plan

> **Version**: 1.0.0
> **Last Updated**: 2026-01-04

## Technology Stack Summary

The following technology decisions have been made for Project Athena:

| Category | Technology | Purpose |
|----------|------------|---------|
| Package Manager | pnpm | Disk-efficient dependency management |
| Monorepo | Turborepo | Build orchestration with caching |
| Backend | Hono | Lightweight, fast web framework |
| Database | PostgreSQL + Drizzle ORM | Type-safe data persistence |
| Frontend | Next.js 15 | SSR-first React meta-framework |
| UI Components | shadcn/ui + Radix + Tailwind | Accessible, customizable UI |
| Testing | Vitest (80% coverage) | Fast, modern test framework |
| E2E Testing | Playwright | Cross-browser testing |
| CI/CD | GitHub Actions | Automated pipelines |
| Commits | Conventional Commits + Husky | Standardized, validated commits |
| Releases | semantic-release | Automated versioning |
| API Docs | Scalar + OpenAPI | Interactive documentation |
| API Versioning | Header-based | `Accept: application/vnd.athena.v1+json` |
| Auth | better-auth | Modern TypeScript auth |
| Payments | Stripe | Payment processing |
| Logging | Pino | Fast JSON logging |
| Validation | Zod (input + output) | Runtime type safety |
| Env Config | dotenv + Zod | Validated environment |
| Doc Comments | TSDoc | TypeScript documentation |
| Error Monitoring | Sentry | Error tracking & observability |
| Deployment | Google Cloud Run | Serverless containers |

For detailed specifications, see:
- [Architecture](../engineering/architecture.md)
- [Tech Stack](../engineering/tech-stack.md)
- [API Design](../engineering/api-design.md)
- [Testing Strategy](../engineering/testing-strategy.md)

---

# Part 0: Tooling and Configuration

We're going to start off by generating additional information and context-providing documentation and guidance that will inform other agents that work on our project.

## Key Deliverables

* AGENTS.md - Agent workflow and operational guidelines
* CLAUDE.md - Symlink to AGENTS.md for Claude Code
* WORKLOG.md - Work tracking and task management
* Engineering documentation (architecture, tech stack, API design, testing)
* Contributing documentation (workflow, code style)

## Technical Overview

We are going to create a core set of documents and utility files.

These docs can be broadly categorized as one of three things:

* **General product information**: The core principles and guidance for *how* and *why* development takes place, including documentation for overall plans and the actual features (e.g. this document)
* **Engineering specs**: Architectural and structural information about the various high-level parts of our product's implementation that operationalizes our product
* **Repo-specific guidance**: Information about tooling used to build our product that operationalize our engineering specs

We organize our information according to the Diátaxis framework while being flexible to the needs of our project. Code should be self-documenting and always be accompanied by TSDoc comments that provide additional value and cross-context information.

## Approach

For now, we're going to centralize all of this documentation in a monorepo for our web client and our main back end service. For the development of all future work, each platform will be in a different repo:

* **athena-service**: Web app, core backend service and APIs, main documentation
* **athena-ios** (future): Native iOS app
* **athena-android** (future): Native Android app 

# Part 1: Core APIs

We’re going to implement the back-end server for this so that we can work on our Android app, Apple app, and web app concurrently.

## Technical Overview

We’re going to build a back-end service on Hono, deployed to Google Cloud Run. This back-end service will be production-ready and handle *all* server-side functionality for Project Athena, including any necessary hooks for external services like authentication or webhooks for data. Generally, we will adopt a RESTful architecture and HTTP semantics for user-facing data whenever possible.

For data persistence, we just need a relatively cheap PostgreSQL solution that integrates with the rest of our stack. The actual solution doesn’t really matter as long as we create an industry-standard secure solution, probably involving row-level security and other standard auth mechanisms.

Our back end service should support internal API endpoints for admin-level service management, not just for authentication and account status, but anything that would be of use in a customer service context.

Our implementation should support encryption at rest of user data, and we should be able to verify that during testing.

We need something that can be safely deployed to production, but we don’t necessarily need infrastructure that can scale to a billion users. Just something that can genuinely work and provide value to users across the several app clients we intend on implementing.

We’re going to use Zod to handle input validation whenever possible. We’re also going to use the Hono OpenAPI integration to automatically generate public documentation for our entire service. This is very important as we are going to minimize the amount of truly internal endpoints needed for our service. API documentation will need to be extremely thorough as it will be the source of truth for all downstream clients.

We will adopt end to end testing for all endpoints, accounting for 

Our implementation will exist in a TS-oriented monorepo that breaks up functionality across several domain-specific supporting packages and a single exposed server application.

## Key Deliverables

* Robust documentation  
* A REST API back end service for all core data types  
* Cross-platform-ready authentication stack  
* Data persistence layer with optimizations for our core app use cases  
* Tooling that supports continuous integration and deployment  
* End to end testing for all core user journeys

## Authentication

We’re going to use the relatively new better-auth library to actually implement the server.

Users should be able to use self-service means to create an account and sign in. We will support WebAuthn

Our service is an OAuth 2.1-compatible client.

Our implementation should be robust to changes in external identity providers. In any case, a user should be able to recover access to their data. We should treat Athena’s representation of a user’s identity as the primary one, considering third-party IdPs as associated links rather than sources of truth.

### Sign-in with Google

The service must be able to handle sign in with Google flows. Since we are trying to one-shot this, we may as well include support for edge cases like a user’s Google account being deleted. 

We should also account for the various security implications for relying on third-party identity providers. Generally, the scope of this involves following Google’s guidance for its Cross-Account Protection (RISC) implementation.[^1]

### Sign-in with Apple

The service must be able to handle Sign in with Apple flows. Like with Google, we should be able to handle edge cases involving account management events from Apple’s end, like email changes and disabled accounts.

### Sign-in with Microsoft

The service must be able to handle Sign in with Microsoft flows. Like with Google, we should be able to handle edge cases involving account management events from Apple’s end, like email changes and disabled accounts.

It should be noted that our implementation should generally be compatible with while still

## Billing

For billing and other payment functionality, we will rely on Stripe. For now, we only need to support two product plans: a free tier and a paid tier. It should be easy for a client to query the back end to determine whether a user should have access to a particular tier of service.

We will opt to use Stripe’s user-facing UI for actions like modifying payment information or changing subscriptions just to speed up development.

This service needs to support an endpoint to query a user’s current plan. Plan modifications only need to be handled internally, not necessarily through an external REST API.

There will also need to be endpoints that are related to a user’s ability to access features, what we’ll call entitlements. A user is entitled to access a particular feature if they are currently subscribed to a plan that allows access to that feature.

We will also need to support being able to provide discounts or other kinds of plan modifications for different customer use cases, like student discounts

## Core Data Types and Functionality

All core functionality across all product surfaces is built on top of these core data types.

### Activity

An activity is a thing that is done by an individual actor at a particular time and has an observed end.

Examples of activities include going for a run, listening to music, or reading.

Using activity data, it is possible to answer aggregating or discriminating questions like “how much time did I spend exercising last year?” or “at what time of day did I read most often?”

Activities are typed, so that means an activity like “play chess” or “practice piano” generally does not make sense unless there is an associated owner.

An activity can have other instance-specific metadata attached to it, like links to external representations of that activity. For example, an activity for running in the park may have Strava data attached to it.

In general, for activities provided by third-party sources, each of those sources is considered the authoritative data source. It is expected that our service will cache or otherwise duplicate that information and sync it to ensure users never lose access to their services’ respective data.

### Activity Stream

The set of all activities with a particular ownership (e.g. listening to Spotify, exercising with Strava). The key constraint with an activity stream is that multiple activities may not occur at the same time within the same stream.

Activity streams may be visualized

### Moment

A moment is a generic boundaried container for time. A moment has a start and end time. It optionally has a label and a description.

Athena uses moments for functionality like time-boxing.

### Event

Events are scheduled moments with pre-defined schedules involving one or more participants. An event may be boundless (e.g. all-day) or bound to a specific start and end time.

An event may have other metadata associated with it.

Our event implementation is backward and generally forward compatible with standard calendar events and related functionality from other services.

A particular company meeting is an event, not an activity.

A run-club meetup at a particular time is an event, but the act of running is an activity.

Time set aside to work on a few tasks is not 

### Task

A task is the basic unit of completable work. Tasks are generic and assignable to a particular actor (human or otherwise).

Tasks may be assigned to a particular moment (i.e. time-boxed) for completion, but a task on its own is not schedulable *as* a moment. It may have an associated start time that can be used as metadata for a scheduler, but a task is temporally independent.

Tasks should not be treated as activities as tasks must have specific criteria for completion. “Play chess” is not a good task, but “Play three games of chess for practice” is.

### Project

A project is a time-bound collection of tasks that consume a particular set of resources.

Although projects may not be nested,

### Initiative

An initiative is a strategic

Initiatives may be nested. For an example, a company

### Agenda

An agenda is a collection of tasks and events scheduled for a given day.

## Assistant Endpoints

Our app’s digital assistant, Athena, will support basic endpoints to enable clients to take actions. The Athena endpoints will exist independently of the raw (direct) data management APIs.

These endpoints include:

* CRUDing new interactive assistant sessions and their metadata  
* Adding messages to an existing session

We represent assistant interactions in terms of **interaction** objects in **sessions**. (Note that in this context, assistant sessions are unrelated to MCP sessions). In general, a **conversation** is just a session with a particular start and end boundary (e.g. particular messages).

## Model Context Protocol

Our service will support exposing key functionality via Model Context Protocol to allow for integrations with third-party AI tools.

This means that we will need to implement all necessary functionality to be an OAuth 2.1 resource server.

We will use Streamable HTTP as our transport, not supporting any other transports (e.g. SSE).

For authorization, we will support all of the supported forms for backward compatibility:

* OAuth Client ID Metadata Documents  
* Preregistration  
* Dynamic Client Registration

Our MCP functionality will focus on key use cases as opposed to providing endpoints for every single resource or API.

### Tools

We will support the following tools

* get\_user\_agenda(date?)  
  * Retrieves the agenda for the currently authenticated user. If a date is provided, the agenda for the given day will be provided. If not, the current calendar day (as determined by the server) will be used.  
* get\_activities(date)  
  * Retrieves all of the activities for the currently authenticated user  
* schedule\_event(description, start\_time?, end\_time?)  
  * May request additional information using elicitations  
* create\_initiative(description)  
  * Creates an initiative using information provided in the given description  
* create\_project(description)  
  * Creates a project using information provided in the given description  
  * Returns an object containing:  
    * Project ID  
    * 

These tools will be built in such a way to make reuse of our own internal tool representations. In other words, these tools will just be a subset of tools that are already accessible to Athena.

### Elicitations

We will provide server-side support for elicitations.

Generally, these will be used if the Athena assistant determines that additional context or information would help it be more effective at accomplishing a task. If a client does not support elicitations, 

We will also include support for the 2025-11-25 MCP spec’s URL solicitations.

### Resources

We expose the following resources:

* Tasks  
* Projects  
* Initiatives  
* Events  
* Activities

### Utilities

We will support the following	 MCP utilities, including:

* Cancellation  
* Ping  
* Progress  
* Tasks (new as of 2025-11-25)  
* Logging  
* Pagination

[^1]:  [https://developers.google.com/identity/protocols/risc](https://developers.google.com/identity/protocols/risc)
