ALTER TYPE "public"."attachment_kind" ADD VALUE 'file';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'discord' BEFORE 'google_calendar';--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"count" integer,
	"last_request" bigint
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "blob_key" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "byte_size" integer;--> statement-breakpoint
CREATE INDEX "rate_limit_key_idx" ON "rate_limit" USING btree ("key");