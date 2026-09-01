CREATE TYPE "public"."probe_outcome" AS ENUM('up', 'degraded', 'down', 'disabled', 'unknown');--> statement-breakpoint
CREATE TABLE "service_probe" (
	"id" text PRIMARY KEY NOT NULL,
	"service_key" text NOT NULL,
	"outcome" "probe_outcome" NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status_code" integer,
	"reason" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_control" DROP CONSTRAINT "service_control_key_check";--> statement-breakpoint
CREATE INDEX "service_probe_service_checked_idx" ON "service_probe" USING btree ("service_key","checked_at");--> statement-breakpoint
ALTER TABLE "service_control" ADD CONSTRAINT "service_control_key_check" CHECK ("service_control"."key" IN ('lattice_submissions', 'lattice_polling', 'service_probes'));