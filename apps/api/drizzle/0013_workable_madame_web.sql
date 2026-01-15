CREATE TYPE "public"."onboarding_step" AS ENUM('intent', 'integrations', 'agenda');--> statement-breakpoint
ALTER TABLE "onboarding_progress" ALTER COLUMN "current_step" SET DEFAULT 'intent'::"public"."onboarding_step";--> statement-breakpoint
ALTER TABLE "onboarding_progress" ALTER COLUMN "current_step" SET DATA TYPE "public"."onboarding_step" USING "current_step"::"public"."onboarding_step";--> statement-breakpoint
ALTER TABLE "onboarding_progress" DROP COLUMN "completed_steps";