'use client';
import type { JSX } from 'react';
import { Button, Field } from '@docket/ui/primitives';
import { defaultEntityDisplay } from '@docket/work/entity-display-contract';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import type { WorkTemplateFormState } from './use-work-template-form';

/** Reuse the shared glyph catalog for template identity without offering unstored color choices. */
export function WorkTemplateGlyphField({
  orgId,
  form,
  isBase,
}: {
  orgId: string;
  form: WorkTemplateFormState;
  isBase: boolean;
}): JSX.Element {
  const display = defaultEntityDisplay(form.kind, 'template-draft');
  const disabled = form.pending || !form.canEdit || isBase;
  return (
    <Field label="Template icon">
      <div className="flex items-center gap-3">
        <EntityIconPicker
          display={{
            ...display,
            colorKey: 'neutral',
            glyph: form.definition.icon ?? display.glyph,
          }}
          workspaceId={orgId}
          entityName={form.definition.name || 'template'}
          editable={!disabled}
          pending={form.pending}
          showColorControls={false}
          onChange={(icon) => {
            form.setDefinition((value) => ({ ...value, icon }));
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || form.definition.icon === null}
          onClick={() => {
            form.setDefinition((value) => ({ ...value, icon: null }));
          }}
        >
          Use work icon
        </Button>
      </div>
    </Field>
  );
}
