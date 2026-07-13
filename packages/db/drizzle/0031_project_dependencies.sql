CREATE TABLE "project_dependency" (
	"blocking_project_id" text NOT NULL,
	"blocked_project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "project_dependency_blocking_project_id_blocked_project_id_pk" PRIMARY KEY("blocking_project_id","blocked_project_id"),
	CONSTRAINT "project_dependency_no_self" CHECK ("project_dependency"."blocking_project_id" <> "project_dependency"."blocked_project_id")
);
--> statement-breakpoint
ALTER TABLE "project_dependency" ADD CONSTRAINT "project_dependency_blocking_project_id_project_id_fk" FOREIGN KEY ("blocking_project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dependency" ADD CONSTRAINT "project_dependency_blocked_project_id_project_id_fk" FOREIGN KEY ("blocked_project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dependency" ADD CONSTRAINT "project_dependency_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_dependency_blocked_idx" ON "project_dependency" USING btree ("blocked_project_id");
