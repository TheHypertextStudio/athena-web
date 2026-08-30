ALTER TABLE "agent_delegation" DROP CONSTRAINT "agent_delegation_reply_key_lifecycle_check";--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD COLUMN "submission_lease_token" text;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD COLUMN "submission_lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD COLUMN "runtime_name" text;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD COLUMN "runtime_reachability" text;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD COLUMN "runtime_last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD COLUMN "relay_queue_position" integer;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_submission_lease_check" CHECK (("agent_delegation"."submission_lease_token" IS NULL AND "agent_delegation"."submission_lease_expires_at" IS NULL)
        OR ("agent_delegation"."status" = 'prepared' AND "agent_delegation"."submission_lease_token" IS NOT NULL AND "agent_delegation"."submission_lease_expires_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_reply_key_lifecycle_check" CHECK (("agent_delegation"."status" in ('prepared','submitted') AND "agent_delegation"."reply_key_ciphertext" IS NOT NULL)
        OR ("agent_delegation"."status" = 'failed' AND "agent_delegation"."failure_code" = 'result_decryption_failed' AND "agent_delegation"."reply_key_ciphertext" IS NOT NULL)
        OR ("agent_delegation"."status" in ('proposed','completed','failed','canceled') AND "agent_delegation"."reply_key_ciphertext" IS NULL));