CREATE TYPE "public"."composer_draft_kind" AS ENUM('task', 'project', 'initiative', 'program', 'team');--> statement-breakpoint
CREATE TABLE "composer_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "composer_draft_kind" NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "composer_draft" ADD CONSTRAINT "composer_draft_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composer_draft" ADD CONSTRAINT "composer_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composer_draft_owner_org_kind_updated_idx" ON "composer_draft" USING btree ("owner_user_id","organization_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "composer_draft_expires_idx" ON "composer_draft" USING btree ("expires_at");