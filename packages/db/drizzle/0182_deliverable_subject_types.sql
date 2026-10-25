ALTER TYPE "public"."attachment_subject_type"
ADD VALUE IF NOT EXISTS 'draft';

--> statement-breakpoint
ALTER TYPE "public"."attachment_subject_type"
ADD VALUE IF NOT EXISTS 'comment';

--> statement-breakpoint
ALTER TYPE "public"."attachment_subject_type"
ADD VALUE IF NOT EXISTS 'update';
