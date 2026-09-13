CREATE TABLE "oauth_jwt_revocation" (
	"token_digest" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_jwt_revocation_digest_ck" CHECK (length("oauth_jwt_revocation"."token_digest") = 43 and "oauth_jwt_revocation"."token_digest" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "oauth_jwt_revocation_lifetime_ck" CHECK ("oauth_jwt_revocation"."expires_at" >= "oauth_jwt_revocation"."revoked_at")
);
--> statement-breakpoint
CREATE TABLE "oauth_resource_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"consent_id" text,
	"authorization_kind" text NOT NULL,
	"resource_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"legacy_before" timestamp with time zone,
	CONSTRAINT "oauth_resource_grant_kind_ck" CHECK ("oauth_resource_grant"."authorization_kind" in ('consent', 'trusted_mcp')),
	CONSTRAINT "oauth_resource_grant_consent_ck" CHECK (("oauth_resource_grant"."authorization_kind" = 'consent' and "oauth_resource_grant"."consent_id" is not null) or ("oauth_resource_grant"."authorization_kind" = 'trusted_mcp' and "oauth_resource_grant"."consent_id" is null)),
	CONSTRAINT "oauth_resource_grant_resource_ck" CHECK (("oauth_resource_grant"."resource_uri" is null and "oauth_resource_grant"."legacy_before" is not null) or ("oauth_resource_grant"."resource_uri" is not null and length("oauth_resource_grant"."resource_uri") > 0)),
	CONSTRAINT "oauth_resource_grant_expiry_ck" CHECK ("oauth_resource_grant"."expires_at" >= "oauth_resource_grant"."created_at"),
	CONSTRAINT "oauth_resource_grant_revoked_ck" CHECK ("oauth_resource_grant"."revoked_at" is null or "oauth_resource_grant"."revoked_at" >= "oauth_resource_grant"."created_at")
);
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "docket_legacy_before" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "docket_legacy_trusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "docket_grant_id" text;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_id_owner_uq" UNIQUE("id","client_id","user_id");--> statement-breakpoint
ALTER TABLE "oauth_resource_grant" ADD CONSTRAINT "oauth_resource_grant_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_resource_grant" ADD CONSTRAINT "oauth_resource_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_resource_grant" ADD CONSTRAINT "oauth_resource_grant_consent_owner_fk" FOREIGN KEY ("consent_id","client_id","user_id") REFERENCES "public"."oauth_consent"("id","client_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_jwt_revocation_expires_at_idx" ON "oauth_jwt_revocation" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_resource_grant_client_user_idx" ON "oauth_resource_grant" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE INDEX "oauth_resource_grant_consent_id_idx" ON "oauth_resource_grant" USING btree ("consent_id");--> statement-breakpoint
CREATE INDEX "oauth_resource_grant_expires_at_idx" ON "oauth_resource_grant" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_resource_grant_id_owner_uq" ON "oauth_resource_grant" USING btree ("id","client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_resource_grant_legacy_pair_uq" ON "oauth_resource_grant" USING btree ("client_id","user_id") WHERE "oauth_resource_grant"."legacy_before" is not null;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_grant_owner_fk" FOREIGN KEY ("docket_grant_id","client_id","user_id") REFERENCES "public"."oauth_resource_grant"("id","client_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_consent_client_user_idx" ON "oauth_consent" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_docket_grant_id_idx" ON "oauth_refresh_token" USING btree ("docket_grant_id");
--> statement-breakpoint
UPDATE "oauth_client"
SET "docket_legacy_before" = CURRENT_TIMESTAMP,
	"docket_legacy_trusted" = ("skip_consent" IS TRUE)
WHERE "docket_legacy_before" IS NULL;
--> statement-breakpoint
WITH "eligible_consent" AS (
	SELECT
		"client_id",
		"user_id",
		min("id") FILTER (WHERE "reference_id" IS NULL) AS "consent_id"
	FROM "oauth_consent"
	WHERE "user_id" IS NOT NULL
	GROUP BY "client_id", "user_id"
	HAVING count(*) FILTER (WHERE "reference_id" IS NULL) = 1
		AND count(*) FILTER (WHERE "reference_id" IS NOT NULL) = 0
), "refresh_expiry" AS (
	SELECT "client_id", "user_id", max("expires_at") AS "expires_at"
	FROM "oauth_refresh_token"
	WHERE "reference_id" IS NULL
	GROUP BY "client_id", "user_id"
)
INSERT INTO "oauth_resource_grant" (
	"id", "client_id", "user_id", "consent_id", "authorization_kind", "resource_uri",
	"created_at", "expires_at", "legacy_before"
)
SELECT
	'legacy_' || md5("eligible_consent"."client_id" || ':' || "eligible_consent"."user_id"),
	"eligible_consent"."client_id",
	"eligible_consent"."user_id",
	"eligible_consent"."consent_id",
	'consent',
	NULL,
	"oauth_client"."docket_legacy_before",
	greatest(
		"oauth_client"."docket_legacy_before" + interval '30 days 15 minutes',
		coalesce("refresh_expiry"."expires_at", "oauth_client"."docket_legacy_before")
	),
	"oauth_client"."docket_legacy_before"
FROM "eligible_consent"
JOIN "oauth_client"
	ON "oauth_client"."client_id" = "eligible_consent"."client_id"
LEFT JOIN "refresh_expiry"
	ON "refresh_expiry"."client_id" = "eligible_consent"."client_id"
	AND "refresh_expiry"."user_id" = "eligible_consent"."user_id"
WHERE "oauth_client"."docket_legacy_trusted" IS NOT TRUE;
--> statement-breakpoint
WITH "trusted_pair" AS (
	SELECT "refresh"."client_id", "refresh"."user_id", max("refresh"."expires_at") AS "expires_at"
	FROM "oauth_refresh_token" AS "refresh"
	JOIN "oauth_client" AS "client" ON "client"."client_id" = "refresh"."client_id"
	WHERE "client"."docket_legacy_trusted" IS TRUE
		AND "refresh"."reference_id" IS NULL
	GROUP BY "refresh"."client_id", "refresh"."user_id"
)
INSERT INTO "oauth_resource_grant" (
	"id", "client_id", "user_id", "consent_id", "authorization_kind", "resource_uri",
	"created_at", "expires_at", "legacy_before"
)
SELECT
	'legacy_' || md5("trusted_pair"."client_id" || ':' || "trusted_pair"."user_id"),
	"trusted_pair"."client_id",
	"trusted_pair"."user_id",
	NULL,
	'trusted_mcp',
	NULL,
	CURRENT_TIMESTAMP,
	greatest(
		CURRENT_TIMESTAMP + interval '30 days 15 minutes',
		coalesce("trusted_pair"."expires_at", CURRENT_TIMESTAMP)
	),
	"oauth_client"."docket_legacy_before"
FROM "trusted_pair"
JOIN "oauth_client"
	ON "oauth_client"."client_id" = "trusted_pair"."client_id"
WHERE NOT EXISTS (
	SELECT 1
	FROM "oauth_resource_grant" AS "existing"
	WHERE "existing"."client_id" = "trusted_pair"."client_id"
		AND "existing"."user_id" = "trusted_pair"."user_id"
		AND "existing"."legacy_before" IS NOT NULL
);
--> statement-breakpoint
UPDATE "oauth_refresh_token" AS "refresh"
SET "docket_grant_id" = "grant"."id"
FROM "oauth_resource_grant" AS "grant"
WHERE "grant"."client_id" = "refresh"."client_id"
	AND "grant"."user_id" = "refresh"."user_id"
	AND "grant"."legacy_before" IS NOT NULL
	AND "refresh"."reference_id" IS NULL
	AND "refresh"."docket_grant_id" IS NULL;
