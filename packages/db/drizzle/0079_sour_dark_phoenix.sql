ALTER TABLE "time_share_token" ADD COLUMN "expires_at" timestamp DEFAULT now() + interval '30 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_share_token" ADD COLUMN "rate_window_started_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "time_share_token" ADD COLUMN "rate_window_count" integer DEFAULT 0 NOT NULL;