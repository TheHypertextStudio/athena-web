ALTER TYPE "public"."mention_subject_type" ADD VALUE 'team';--> statement-breakpoint
ALTER TABLE "entity_display" DROP CONSTRAINT "entity_display_subject_type_check";--> statement-breakpoint
ALTER TABLE "entity_display" ADD COLUMN "cover_image" text;--> statement-breakpoint
ALTER TABLE "entity_display" ADD CONSTRAINT "entity_display_subject_type_check" CHECK ("entity_display"."subject_type" in ('initiative', 'project', 'team'));