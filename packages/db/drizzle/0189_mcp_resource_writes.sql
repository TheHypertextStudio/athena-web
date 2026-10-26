ALTER TYPE "attachment_subject_type"
ADD VALUE IF NOT EXISTS 'program';

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_write_receipt" (
  "organization_id" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "actor_id" text NOT NULL REFERENCES "actor" ("id") ON DELETE CASCADE,
  "namespace" text NOT NULL,
  "request_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "attachment_id" text NOT NULL,
  "blob_key" text,
  "byte_size" integer,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (
    "organization_id",
    "actor_id",
    "namespace",
    "request_id"
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_write_receipt_cleanup_idx" ON "resource_write_receipt" ("completed_at", "created_at");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_write_receipt_rate_idx" ON "resource_write_receipt" ("organization_id", "created_at");

--> statement-breakpoint
ALTER TABLE "resource_write_receipt" ENABLE ROW LEVEL SECURITY;
