CREATE TABLE "lattice_authorization_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"verifier_ciphertext" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text NOT NULL,
	"code_challenge" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lattice_authorization_attempt_status_check" CHECK ("lattice_authorization_attempt"."status" in ('pending','exchanging','completed','declined','failed')),
	CONSTRAINT "lattice_authorization_attempt_outcome_check" CHECK (("lattice_authorization_attempt"."status" = 'pending' AND "lattice_authorization_attempt"."consumed_at" IS NULL AND "lattice_authorization_attempt"."failure_reason" IS NULL)
        OR ("lattice_authorization_attempt"."status" = 'exchanging' AND "lattice_authorization_attempt"."consumed_at" IS NOT NULL AND "lattice_authorization_attempt"."failure_reason" IS NULL)
        OR ("lattice_authorization_attempt"."status" = 'completed' AND "lattice_authorization_attempt"."consumed_at" IS NOT NULL AND "lattice_authorization_attempt"."failure_reason" IS NULL)
        OR ("lattice_authorization_attempt"."status" in ('declined','failed') AND "lattice_authorization_attempt"."consumed_at" IS NOT NULL AND "lattice_authorization_attempt"."failure_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "lattice_authorization_attempt" ADD CONSTRAINT "lattice_authorization_attempt_connection_owner_fk" FOREIGN KEY ("connection_id","owner_user_id") REFERENCES "public"."lattice_connection"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lattice_authorization_attempt_state_uq" ON "lattice_authorization_attempt" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "lattice_authorization_attempt_owner_status_idx" ON "lattice_authorization_attempt" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "lattice_authorization_attempt_expiry_idx" ON "lattice_authorization_attempt" USING btree ("expires_at");