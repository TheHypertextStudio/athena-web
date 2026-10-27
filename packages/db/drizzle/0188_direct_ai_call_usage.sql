CREATE TABLE "ai_call_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "user_id" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "organization_id" text REFERENCES "organization" ("id") ON DELETE SET NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "model" text,
  "backend" text,
  "input_tokens" bigint,
  "output_tokens" bigint,
  "cache_read_tokens" bigint,
  "cache_write_tokens" bigint
);

--> statement-breakpoint
CREATE INDEX "ai_call_usage_occurred_idx" ON "ai_call_usage" ("occurred_at");
