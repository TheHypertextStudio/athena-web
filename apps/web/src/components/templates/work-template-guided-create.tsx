'use client';
import { type JSX, useState } from 'react';
import { useVocabulary } from '@docket/ui/hooks';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { useAppRouter } from '@/lib/interactions/navigation';
import { sectionHref } from '@/components/settings/settings-registry';
import { TemplateEditorDialog } from './template-editor';
import { useWorkTemplateWrites } from './work-template-queries';

/** Preserve guided creation while saving a private draft before explicit publication. */
export function WorkTemplateGuidedCreate({ orgId }: { orgId: string }): JSX.Element {
  const [kind, setKind] = useState<TemplateTargetType | null>(null);
  const writes = useWorkTemplateWrites(orgId);
  const router = useAppRouter();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>New template</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(['task', 'project', 'initiative', 'program'] as const).map((value) => (
            <NewKind
              key={value}
              kind={value}
              onSelect={() => {
                setKind(value);
              }}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {kind ? (
        <TemplateEditorDialog
          orgId={orgId}
          targetType={kind}
          template={null}
          open
          onOpenChange={(open) => {
            if (!open) setKind(null);
          }}
          onSaved={() => {
            setKind(null);
          }}
          saveDraft={async (input) => {
            const result = await writes.create.mutateAsync(
              WorkTemplateCreate.parse({
                targetType: input.targetType,
                scope: 'personal',
                definition: {
                  name: input.name,
                  description: input.description ?? null,
                  icon: null,
                  defaultStatusKey:
                    'status' in input.payload ? (input.payload.status ?? null) : null,
                  payload: input.payload,
                },
              }),
            );
            router.push(`${sectionHref(orgId, 'templates')}/${result.id}`);
          }}
        />
      ) : null}
    </>
  );
}
function NewKind({
  kind,
  onSelect,
}: {
  kind: TemplateTargetType;
  onSelect: () => void;
}): JSX.Element {
  const noun = useVocabulary(kind);
  return <DropdownMenuItem onSelect={onSelect}>{noun}</DropdownMenuItem>;
}
