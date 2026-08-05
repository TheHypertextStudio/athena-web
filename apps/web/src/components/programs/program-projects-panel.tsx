'use client';

/**
 * The Program page's Projects tab — the projects currently filed under this Program, with
 * controls to file an existing one or create a new one straight into it.
 *
 * @remarks
 * Before this panel, a Project could only be filed under a Program from the *Project's* own
 * Properties panel — there was no way to do it from the Program side at all. This mirrors the
 * add/remove-entity-picker pattern {@link "@/components/project-detail/project-dependencies"}
 * already established: an `EntityPicker` with a permanently-null `value` acts as a stateless
 * "add" trigger, and each row gets its own remove button.
 */
import type { ProjectOut, TeamOut } from '@docket/types';
import { EntityPicker } from '@docket/ui/components';
import { Plus, X } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import type { QueryKey } from '@tanstack/react-query';
import Link from 'next/link';
import { type JSX, useMemo, useState } from 'react';

import { CreateProjectDialog } from '@/components/projects/create-project';
import { ProjectStatusBadge } from '@/components/projects/project-status';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useProgramProjects } from '@/lib/use-program-projects';

/** Props for {@link ProgramProjectsPanel}. */
export interface ProgramProjectsPanelProps {
  orgId: string;
  programId: string;
  programDetailKey: QueryKey;
  /** Vocabulary-skinned singular project noun (e.g. "Project", "Workstream"). */
  projectNoun: string;
  /** The teams a newly-created project may be attached to. */
  teams: readonly TeamOut[];
  defaultTeamId: string | null;
  teamsLoading: boolean;
  canEdit: boolean;
  /** Navigate to a project's own detail view. */
  onOpenProject: (projectId: string) => void;
}

/** The Program's own Projects tab: list, file-existing, and create-into-this-program. */
export function ProgramProjectsPanel({
  orgId,
  programId,
  programDetailKey,
  projectNoun,
  teams,
  defaultTeamId,
  teamsLoading,
  canEdit,
  onOpenProject,
}: ProgramProjectsPanelProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();
  const options = useComposerOptions(orgId, ['projects'], true);
  const { attach, detach, pending, mutationError } = useProgramProjects(
    orgId,
    programId,
    programDetailKey,
  );
  const [createOpen, setCreateOpen] = useState(false);

  const filed = useMemo<readonly ProjectOut[]>(
    () => options.projects.filter((project) => project.programId === programId),
    [options.projects, programId],
  );
  const unfiledOptions = useMemo(
    () =>
      options.projects
        .filter((project) => project.programId !== programId)
        .map((project) => ({ value: project.id, label: project.name })),
    [options.projects, programId],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-on-surface-variant text-body-medium">
          {filed.length > 0
            ? `${filed.length} ${filed.length === 1 ? projectNounLower : `${projectNounLower}s`}`
            : `No ${projectNounLower}s yet.`}
        </p>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-2">
            <EntityPicker
              options={unfiledOptions}
              value={null}
              onChange={(value) => {
                if (value) attach(value);
              }}
              placeholder={`Add ${projectNounLower}`}
              searchPlaceholder={`Search ${projectNounLower}s…`}
              emptyText={`No other ${projectNounLower}s`}
              ariaLabel={`Add ${projectNounLower}`}
              disabled={pending || options.loading}
              triggerVariant="outline"
            />
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5"
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" />
              New {projectNounLower}
            </Button>
          </div>
        ) : null}
      </div>

      {options.loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ) : filed.length === 0 ? (
        <p className="border-outline-variant text-on-surface-variant text-body-medium rounded-xl border border-dashed p-8 text-center">
          File a {projectNounLower} under this program to see it here.
        </p>
      ) : (
        <ul className="border-outline-variant divide-outline-variant divide-y overflow-hidden rounded-xl border">
          {filed.map((project) => (
            <li
              key={project.id}
              className="hover:bg-surface-container-high flex items-center gap-3 px-3 py-2.5"
            >
              <Link
                href={`/orgs/${orgId}/projects/${project.id}`}
                className="text-on-surface text-body-medium min-w-0 flex-1 truncate"
              >
                {project.name}
              </Link>
              <ProjectStatusBadge status={project.status} />
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${project.name} from this program`}
                  disabled={pending}
                  onClick={() => {
                    detach(project.id);
                  }}
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mutationError ? (
        <p role="alert" className="text-error text-body-medium">
          {mutationError}
        </p>
      ) : null}

      <CreateProjectDialog
        orgId={orgId}
        projectNoun={projectNoun}
        teams={teams}
        defaultTeamId={defaultTeamId}
        teamsLoading={teamsLoading}
        defaultProgramId={programId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => {
          setCreateOpen(false);
          onOpenProject(created.id);
        }}
      />
    </div>
  );
}
