-- Reviewer allowances must outlive Better Auth's short-lived rate-limit cleanup.
-- Each demo has a bounded number of reusable counter and stream-lease rows.
CREATE TABLE "demo_budget" (
  "id" text PRIMARY KEY NOT NULL,
  "demo_id" text NOT NULL REFERENCES "demo" ("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "count" integer NOT NULL,
  "last_request" bigint NOT NULL
);
