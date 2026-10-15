'use client';
import { useState } from 'react';
import type {
  WorkTemplateChangeField,
  WorkTemplateChangePreview,
  WorkTemplateChildChange,
} from '@docket/work/work-template-reference';
import { templateChildChoiceKey } from './work-template-child-changes';

interface TemplateChangeChoices {
  readonly fields: readonly WorkTemplateChangeField[];
  readonly children: ReadonlyMap<string, boolean>;
  readonly toggleField: (field: WorkTemplateChangeField) => void;
  readonly toggleChild: (change: WorkTemplateChildChange) => void;
  readonly acceptedFields: () => WorkTemplateChangeField[];
  readonly acceptedChildren: () => string[];
}

/** Checkbox intentions use logical identities so refreshed review tokens never discard a person's choices. */
export function useTemplateChangeChoices(
  preview: WorkTemplateChangePreview | undefined,
): TemplateChangeChoices {
  const [fields, setFields] = useState<WorkTemplateChangeField[]>([]);
  const [children, setChildren] = useState<ReadonlyMap<string, boolean>>(new Map());
  return {
    fields,
    children,
    toggleField: (field: WorkTemplateChangeField): void => {
      setFields((current) =>
        current.includes(field) ? current.filter((value) => value !== field) : [...current, field],
      );
    },
    toggleChild: (change: WorkTemplateChildChange): void => {
      setChildren((current) =>
        new Map(current).set(
          templateChildChoiceKey(change),
          !(current.get(templateChildChoiceKey(change)) ?? change.selectedByDefault),
        ),
      );
    },
    acceptedFields: (): WorkTemplateChangeField[] =>
      fields.filter((field) => preview?.changes.some((change) => change.field === field)),
    acceptedChildren: (): string[] =>
      (preview?.childChanges ?? [])
        .filter(
          (change) => children.get(templateChildChoiceKey(change)) ?? change.selectedByDefault,
        )
        .map((change) => change.changeId),
  };
}
