CREATE TABLE "thread_participation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_workspace_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"external_user_id" text NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_participation" ADD CONSTRAINT "thread_participation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_participation_identity_uq" ON "thread_participation" USING btree ("organization_id","provider","external_workspace_id","channel_id","thread_ts","external_user_id");--> statement-breakpoint
CREATE INDEX "thread_participation_lookup_idx" ON "thread_participation" USING btree ("organization_id","external_workspace_id","channel_id","thread_ts");