'use client';

/** Entity resources tab: linked documents and URLs as first-class operating context. */
import type { AttachmentOut } from '@docket/types';
import { Link as LinkIcon, Plus, Trash2 } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useState } from 'react';

/** Props for {@link ResourcesTab}. */
export interface ResourcesTabProps {
  resources: readonly AttachmentOut[];
  canEdit: boolean;
  pending: boolean;
  error: string | null;
  onAdd: (resource: { title: string; url: string }) => void;
  onRemove: (resourceId: string) => void;
}

/** Render URL resources in a dedicated, dense tab rather than burying them in metadata. */
export function ResourcesTab({
  resources,
  canEdit,
  pending,
  error,
  onAdd,
  onRemove,
}: ResourcesTabProps): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-on-surface text-title-small font-semibold">Resources</h2>
          <p className="text-on-surface-variant mt-1 text-sm">
            Plans, briefs, folders, and external references.
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 gap-1.5"
            onClick={() => {
              setAdding((value) => !value);
            }}
          >
            <Plus aria-hidden className="size-4" /> Add resource
          </Button>
        ) : null}
      </div>

      {adding ? (
        <form
          className="bg-surface-container-low grid gap-3 rounded-xl p-4 @2xl:grid-cols-[minmax(10rem,0.75fr)_minmax(16rem,1.25fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || !url.trim()) return;
            onAdd({ title: title.trim(), url: url.trim() });
            setTitle('');
            setUrl('');
            setAdding(false);
          }}
        >
          <input
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            aria-label="Resource title"
            placeholder="Resource title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <input
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            aria-label="Resource URL"
            placeholder="https://"
            type="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
          <Button
            type="submit"
            size="sm"
            className="min-h-10"
            disabled={pending || !title.trim() || !url.trim()}
          >
            Add
          </Button>
        </form>
      ) : null}

      {resources.length > 0 ? (
        <ul className="bg-surface-container-low rounded-xl p-2">
          {resources.map((resource) => (
            <li
              key={resource.id}
              className="hover:bg-surface-container-high flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 transition-colors"
            >
              <span className="bg-primary-container text-on-primary-container flex size-8 shrink-0 items-center justify-center rounded-full">
                <LinkIcon aria-hidden className="size-5" />
              </span>
              <a
                href={resource.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="text-on-surface min-w-0 flex-1 truncate text-sm font-medium hover:underline"
              >
                {resource.title}
              </a>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-10 min-w-10"
                  aria-label={`Remove ${resource.title}`}
                  disabled={pending}
                  onClick={() => {
                    onRemove(resource.id);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-on-surface-variant bg-surface-container-low rounded-xl px-4 py-8 text-center text-sm">
          No linked resources yet.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
