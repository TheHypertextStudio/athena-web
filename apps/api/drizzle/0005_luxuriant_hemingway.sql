CREATE TABLE "calendar_sync_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"sync_token" text NOT NULL,
	"last_sync_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_integration_id" text;--> statement-breakpoint
ALTER TABLE "calendar_sync_tokens" ADD CONSTRAINT "calendar_sync_tokens_integration_id_linked_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."linked_integrations"("id") ON DELETE cascade ON UPDATE no action;