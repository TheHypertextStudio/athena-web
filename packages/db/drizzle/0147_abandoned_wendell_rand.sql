ALTER TABLE "comment" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "edited_by_id" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "edited_origin" jsonb;--> statement-breakpoint
ALTER TABLE "update" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_edited_by_id_actor_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;