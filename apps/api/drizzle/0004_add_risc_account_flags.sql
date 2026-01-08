-- Add RISC (Cross-Account Protection) fields to accounts table
ALTER TABLE "accounts" ADD COLUMN "google_sign_in_disabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "tokens_revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "credential_change_required" boolean DEFAULT false;--> statement-breakpoint

-- Add security alert field to users table
ALTER TABLE "users" ADD COLUMN "security_alert_at" timestamp;
