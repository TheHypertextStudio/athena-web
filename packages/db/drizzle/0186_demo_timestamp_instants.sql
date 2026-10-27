-- Preserve reviewer expiry and lifecycle instants as UTC, matching authored Date serialization.
-- Already applied migrations stay immutable. Explicit UTC interpretation prevents the migration
-- session timezone from shifting legacy wall-clock values; nulls and defaults remain intact.
ALTER TABLE "demo"
ALTER COLUMN "expires_at" TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';

--> statement-breakpoint
ALTER TABLE "demo_workspace"
ALTER COLUMN "provisioned_at" TYPE timestamp with time zone USING "provisioned_at" AT TIME ZONE 'UTC',
ALTER COLUMN "last_reset_at" TYPE timestamp with time zone USING "last_reset_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expires_at" TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';
