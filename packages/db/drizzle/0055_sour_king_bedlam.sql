CREATE TABLE "execution_request_nonce" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "execution_request_nonce_direction_check" CHECK ("execution_request_nonce"."direction" in ('cloudflare_to_docket', 'docket_to_cloudflare'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "execution_request_nonce_direction_nonce_uq" ON "execution_request_nonce" USING btree ("direction","nonce");--> statement-breakpoint
CREATE INDEX "execution_request_nonce_expiry_idx" ON "execution_request_nonce" USING btree ("expires_at");