ALTER TABLE "workspace_public_slug" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "workspace_public_slug" CASCADE;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_slug_format_check" CHECK ("organization"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("organization"."slug") <= 64);