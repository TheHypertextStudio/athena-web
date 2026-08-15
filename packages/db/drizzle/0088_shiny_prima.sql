-- A process template's Project status becomes a key into the workspace's `work_status` set, the
-- same as `project.status` in `0087`. It carries no composite foreign key: a template is org-wide
-- and long-lived, so the key is resolved when the Project is actually created rather than held to
-- a status that may since have been renamed or deleted.
ALTER TABLE "process_project_spec" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "process_project_spec" ALTER COLUMN "status" SET DEFAULT 'planned';
