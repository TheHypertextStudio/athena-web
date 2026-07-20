CREATE TABLE "billing_exemption" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"reason" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "billing_exemption" ADD CONSTRAINT "billing_exemption_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_exemption" ADD CONSTRAINT "billing_exemption_granted_by_staff_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."staff_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_exemption" ADD CONSTRAINT "billing_exemption_revoked_by_staff_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."staff_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_exemption_org_idx" ON "billing_exemption" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_exemption_org_active_uq" ON "billing_exemption" USING btree ("organization_id") WHERE "billing_exemption"."revoked_at" IS NULL;