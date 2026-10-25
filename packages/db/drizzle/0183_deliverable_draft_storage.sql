CREATE TABLE "attachment_blob_cleanup" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "blob_key" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attachment_blob_cleanup_blob_key_unique" UNIQUE ("blob_key")
);

--> statement-breakpoint
CREATE TABLE "deliverable_upload_session" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "actor_id" text NOT NULL,
  "performer_kind" text NOT NULL,
  "performer_id" text,
  "client_id" text,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "title" text NOT NULL,
  "token_hash" text NOT NULL,
  "attachment_id" text,
  "upload_hash" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deliverable_upload_session_token_hash_unique" UNIQUE ("token_hash")
);

--> statement-breakpoint
CREATE TABLE "mcp_content_receipt" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "caller_key" text NOT NULL,
  "tool_name" text NOT NULL,
  "request_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "post_id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "attachment"
ADD COLUMN "draft_owner_actor_id" text;

--> statement-breakpoint
ALTER TABLE "attachment"
ADD COLUMN "draft_owner_performer_kind" text;

--> statement-breakpoint
ALTER TABLE "attachment"
ADD COLUMN "draft_owner_performer_id" text;

--> statement-breakpoint
ALTER TABLE "attachment"
ADD COLUMN "draft_owner_client_id" text;

--> statement-breakpoint
ALTER TABLE "attachment"
ADD COLUMN "draft_expires_at" timestamp with time zone;

--> statement-breakpoint
ALTER TABLE "attachment"
ADD COLUMN "draft_upload_id" text;

--> statement-breakpoint
ALTER TABLE "attachment"
ADD COLUMN "draft_upload_hash" text;

--> statement-breakpoint
CREATE INDEX "attachment_blob_cleanup_due_idx" ON "attachment_blob_cleanup" USING btree ("next_attempt_at", "id");

--> statement-breakpoint
CREATE INDEX "deliverable_upload_session_expiry_idx" ON "deliverable_upload_session" USING btree ("expires_at", "id");

--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_content_receipt_request_uq" ON "mcp_content_receipt" USING btree (
  "organization_id",
  "caller_key",
  "tool_name",
  "request_id"
);

--> statement-breakpoint
CREATE INDEX "mcp_content_receipt_expiry_idx" ON "mcp_content_receipt" USING btree ("expires_at", "id");

--> statement-breakpoint
CREATE INDEX "attachment_draft_owner_idx" ON "attachment" USING btree (
  "organization_id",
  "draft_owner_actor_id",
  "draft_expires_at"
)
WHERE
  "attachment"."draft_expires_at" is not null;

--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_draft_upload_uq" ON "attachment" USING btree ("organization_id", "draft_upload_id")
WHERE
  "attachment"."draft_upload_id" is not null;

--> statement-breakpoint
ALTER TABLE "attachment"
ADD CONSTRAINT "attachment_draft_owner_check" CHECK (
  (
    "attachment"."subject_type"::text = 'draft'
    and "attachment"."draft_owner_actor_id" is not null
    and "attachment"."draft_owner_performer_kind" is not null
    and "attachment"."draft_expires_at" is not null
  )
  or (
    "attachment"."subject_type"::text <> 'draft'
    and "attachment"."draft_owner_actor_id" is null
    and "attachment"."draft_owner_performer_kind" is null
    and "attachment"."draft_owner_performer_id" is null
    and "attachment"."draft_owner_client_id" is null
    and "attachment"."draft_expires_at" is null
    and "attachment"."draft_upload_id" is null
    and "attachment"."draft_upload_hash" is null
  )
);

--> statement-breakpoint
ALTER TABLE "attachment"
ADD CONSTRAINT "attachment_draft_upload_check" CHECK (
  (
    "attachment"."subject_type"::text = 'draft'
    and (
      (
        "attachment"."draft_upload_id" is null
        and "attachment"."draft_upload_hash" is null
      )
      or (
        "attachment"."draft_upload_id" is not null
        and "attachment"."draft_upload_hash" is not null
      )
    )
  )
  or (
    "attachment"."subject_type"::text <> 'draft'
    and "attachment"."draft_upload_id" is null
    and "attachment"."draft_upload_hash" is null
  )
);
