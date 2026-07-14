'use client';

/** A compact in-context Project dependency panel. */
import { EntityPicker } from '@docket/ui/components';
import { Link as LinkIcon, X } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import type { QueryKey } from '@tanstack/react-query';
import Link from 'next/link';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useProjectDependencies } from '@/lib/use-project-dependencies';

/** Props for {@link ProjectDependenciesPanel}. */
export interface ProjectDependenciesPanelProps {
  orgId: string;
  projectId: string;
  projectDetailKey: QueryKey;
  canEdit: boolean;
}

/** Render incoming and outgoing Project edges, with contextual add/remove controls. */
export function ProjectDependenciesPanel({
  orgId,
  projectId,
  projectDetailKey,
  canEdit,
}: ProjectDependenciesPanelProps): JSX.Element {
  const options = useComposerOptions(orgId, ['projects'], true);
  const { dependencies, loading, error, add, remove, pending, mutationError } =
    useProjectDependencies(orgId, projectId, projectDetailKey);
  const projectOptions = useMemo(
    () => options.projectOptions.filter((option) => option.value !== projectId),
    [options.projectOptions, projectId],
  );

  return (
    <section
      aria-label="Project dependencies"
      className="border-outline-variant bg-surface-container-low flex flex-col gap-4 rounded-xl border p-4"
    >
      <div className="flex items-center gap-2">
        <LinkIcon aria-hidden="true" className="text-on-surface-variant size-4" />
        <h2 className="text-on-surface text-body-medium font-semibold">Dependencies</h2>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-6 w-48" />
        </div>
      ) : error ? (
        <p role="alert" className="text-destructive text-body-medium">
          {error}
        </p>
      ) : (
        <div className="grid gap-4 @2xl:grid-cols-2">
          <DependencyColumn
            title="Blocked by"
            emptyText="Nothing is blocking this project."
            projects={dependencies.blockedBy}
            orgId={orgId}
            canEdit={canEdit}
            pickerLabel="Add blocker"
            pickerOptions={projectOptions}
            disabled={pending}
            onAdd={(id) => {
              add('blockedBy', id);
            }}
            onRemove={remove}
          />
          <DependencyColumn
            title="Blocks"
            emptyText="This project does not block other projects."
            projects={dependencies.blocking}
            orgId={orgId}
            canEdit={canEdit}
            pickerLabel="Add dependent"
            pickerOptions={projectOptions}
            disabled={pending}
            onAdd={(id) => {
              add('blocking', id);
            }}
            onRemove={remove}
          />
        </div>
      )}
      {mutationError ? (
        <p role="alert" className="text-destructive text-body-medium">
          {mutationError}
        </p>
      ) : null}
    </section>
  );
}

interface DependencyColumnProps {
  title: string;
  emptyText: string;
  projects: readonly { id: string; name: string }[];
  orgId: string;
  canEdit: boolean;
  pickerLabel: string;
  pickerOptions: readonly { value: string; label: string }[];
  disabled: boolean;
  onAdd: (projectId: string) => void;
  onRemove: (projectId: string) => void;
}

function DependencyColumn({
  title,
  emptyText,
  projects,
  orgId,
  canEdit,
  pickerLabel,
  pickerOptions,
  disabled,
  onAdd,
  onRemove,
}: DependencyColumnProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-on-surface-variant text-sm font-medium">{title}</h3>
        {canEdit ? (
          <EntityPicker
            options={pickerOptions}
            value={null}
            onChange={(value) => {
              if (value) onAdd(value);
            }}
            placeholder={pickerLabel}
            searchPlaceholder="Search projects…"
            ariaLabel={pickerLabel}
            disabled={disabled}
          />
        ) : null}
      </div>
      {projects.length === 0 ? (
        <p className="text-on-surface-variant text-xs">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {projects.map((project) => (
            <li key={project.id} className="flex min-w-0 items-center gap-1">
              <Link
                href={`/orgs/${orgId}/projects/${project.id}`}
                className="text-on-surface hover:text-primary min-w-0 flex-1 truncate rounded px-1 py-1 text-sm transition-colors"
              >
                {project.name}
              </Link>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${project.name} dependency`}
                  disabled={disabled}
                  onClick={() => {
                    onRemove(project.id);
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
