CREATE TABLE IF NOT EXISTS "file_upload" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "actor_id" text NOT NULL,
  "owner_key" text NOT NULL,
  "performer_kind" text NOT NULL,
  "performer_id" text,
  "client_id" text,
  "request_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "title" text NOT NULL,
  "byte_size" integer NOT NULL CHECK (
    "byte_size" > 0
    AND "byte_size" <= 104857600
  ),
  "crc32c" text NOT NULL,
  "attachment_id" text NOT NULL,
  "blob_key" text NOT NULL,
  "capability" text,
  "state" text NOT NULL DEFAULT 'pending' CHECK (
    "state" IN ('pending', 'completed', 'cancelled', 'cleaned')
  ),
  "expires_at" timestamptz NOT NULL,
  "cleanup_attempts" integer NOT NULL DEFAULT 0,
  "cleanup_after" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_upload_request_idx" ON "file_upload" ("organization_id", "owner_key", "request_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_upload_pending_idx" ON "file_upload" ("organization_id", "state", "expires_at");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_upload_rate_idx" ON "file_upload" ("organization_id", "created_at");

--> statement-breakpoint
ALTER TABLE "file_upload" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_upload_cleanup_idx" ON "file_upload" ("state", "cleanup_after", "expires_at");
