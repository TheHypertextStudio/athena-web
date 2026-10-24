'use client';
import { TabsScope, TabPanel } from '@docket/ui/primitives';
import { type JSX, type ReactNode } from 'react';

import { TemplateDefinitionNavigation } from './template-definition-navigation';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import type { useTemplateSectionNavigation } from './use-template-section-navigation';
import { WorkTemplateFields, WorkTemplatePurposeFields } from './work-template-fields';
import { WorkTemplateBlueprintFields } from './work-template-blueprint-fields';
import { WorkTemplateDefinitionReview } from './work-template-definition-review';
import type { WorkTemplateFormState } from './use-work-template-form';

/** Guided, freely revisitable organization work definition; mounted editors retain their place. */
export function TemplateDefinitionSections({
  orgId,
  initial,
  form,
  children,
  header,
  reviewIntro,
  navigation,
  mode = 'edit',
  reached,
  onContinue,
}: {
  onContinue?: (() => void) | undefined;
  mode?: 'create' | 'edit';
  reached?: number;
  orgId: string;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
  children: ReactNode;
  header: ReactNode;
  reviewIntro: ReactNode;
  navigation: ReturnType<typeof useTemplateSectionNavigation>;
}): JSX.Element {
  const { section, selectSection, rememberFocus } = navigation;
  return (
    <TabsScope scope={navigation.scope}>
      <>
        <header data-template-definition-header="" className="flex min-w-0 flex-col gap-4">
          {header}
          <TemplateDefinitionNavigation
            section={section}
            onValueChange={selectSection}
            pending={form.pending}
            mode={mode}
            reached={reached}
            scope={navigation.scope}
          />
        </header>
        <DefinitionPurpose
          orgId={orgId}
          initial={initial}
          form={form}
          hidden={section !== 'purpose'}
          onFocusCapture={rememberFocus}
        />
        <DefinitionWork
          orgId={orgId}
          initial={initial}
          form={form}
          hidden={section !== 'work'}
          onFocusCapture={rememberFocus}
          onEditStructure={() => {
            if (mode === 'create') onContinue?.();
            else selectSection('structure');
          }}
        />
        <DefinitionStructure orgId={orgId} form={form} navigation={navigation} />
        <TabPanel
          hidden={!(section === 'review')}
          as="div"
          value="review"
          className="flex min-w-0 scroll-mt-48 flex-col gap-6"
          render={() => (
            <>
              <div>{reviewIntro}</div>
              <WorkTemplateDefinitionReview orgId={orgId} form={form} templateId={initial?.id} />
              <div className="flex min-w-0 flex-col gap-6">{children}</div>
            </>
          )}
        />
      </>
    </TabsScope>
  );
}

function DefinitionWork({
  orgId,
  initial,
  form,
  hidden,
  onFocusCapture,
  onEditStructure,
}: {
  onEditStructure: () => void;
  orgId: string;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
  hidden: boolean;
  onFocusCapture: React.FocusEventHandler<HTMLElement>;
}): JSX.Element {
  return (
    <TabPanel
      as="div"
      value="work"
      hidden={hidden}
      onFocusCapture={onFocusCapture}
      className="scroll-mt-48"
    >
      <WorkTemplateFields
        orgId={orgId}
        form={form}
        isBase={initial?.isBase ?? false}
        onEditStructure={onEditStructure}
        active={!hidden}
      />
    </TabPanel>
  );
}

function DefinitionPurpose({
  orgId,
  initial,
  form,
  hidden,
  onFocusCapture,
}: {
  orgId: string;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
  hidden: boolean;
  onFocusCapture: React.FocusEventHandler<HTMLElement>;
}): JSX.Element {
  return (
    <TabPanel
      as="div"
      value="purpose"
      hidden={hidden}
      onFocusCapture={onFocusCapture}
      className="scroll-mt-48"
    >
      <div>
        <WorkTemplatePurposeFields
          orgId={orgId}
          form={form}
          existing={initial !== null}
          isBase={initial?.isBase ?? false}
        />
      </div>
    </TabPanel>
  );
}

function DefinitionStructure({
  orgId,
  form,
  navigation,
}: {
  orgId: string;
  form: WorkTemplateFormState;
  navigation: ReturnType<typeof useTemplateSectionNavigation>;
}): JSX.Element {
  return (
    <TabPanel
      as="div"
      value="structure"
      hidden={navigation.section !== 'structure'}
      onFocusCapture={navigation.rememberFocus}
      className="scroll-mt-48"
    >
      <WorkTemplateBlueprintFields orgId={orgId} form={form} />
    </TabPanel>
  );
}
