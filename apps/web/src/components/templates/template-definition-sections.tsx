'use client';
import { TabsScope, TabPanel, Button, Surface } from '@docket/ui/primitives';
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
}: {
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
        <Surface
          as="header"
          data-template-definition-header=""
          tone="prominent"
          shape="medium"
          pad="tight"
          className="flex min-w-0 flex-col gap-1 px-3 sm:sticky sm:top-2 sm:z-10 sm:gap-2 sm:p-5"
        >
          {header}
          <TemplateDefinitionNavigation section={section} onValueChange={selectSection} />
        </Surface>
        <DefinitionPurpose
          orgId={orgId}
          initial={initial}
          form={form}
          hidden={section !== 'purpose'}
          onFocusCapture={rememberFocus}
          onNext={() => {
            selectSection('work');
          }}
        />
        <DefinitionWork
          orgId={orgId}
          initial={initial}
          form={form}
          hidden={section !== 'work'}
          onFocusCapture={rememberFocus}
          onReview={() => {
            selectSection('structure');
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
              <div className="px-3 sm:px-0">{reviewIntro}</div>
              <WorkTemplateDefinitionReview orgId={orgId} form={form} templateId={initial?.id} />
              <div className="flex min-w-0 flex-col gap-6 px-3 sm:px-0">{children}</div>
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
  onReview,
  onFocusCapture,
}: {
  orgId: string;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
  hidden: boolean;
  onReview: () => void;
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
      <WorkTemplateFields orgId={orgId} form={form} isBase={initial?.isBase ?? false} />
      <Button
        type="button"
        variant="secondary"
        className="mt-6 ml-3 sm:ml-0"
        onClick={() => {
          onReview();
        }}
      >
        Continue to included work
      </Button>
    </TabPanel>
  );
}

function DefinitionPurpose({
  orgId,
  initial,
  form,
  hidden,
  onFocusCapture,
  onNext,
}: {
  orgId: string;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
  hidden: boolean;
  onFocusCapture: React.FocusEventHandler<HTMLElement>;
  onNext: () => void;
}): JSX.Element {
  return (
    <TabPanel
      as="div"
      value="purpose"
      hidden={hidden}
      onFocusCapture={onFocusCapture}
      className="scroll-mt-48"
    >
      <Surface tone="card" shape="medium" pad="comfortable" className="sm:p-6">
        <WorkTemplatePurposeFields
          orgId={orgId}
          form={form}
          existing={initial !== null}
          isBase={initial?.isBase ?? false}
        />
        <Button
          type="button"
          variant="secondary"
          className="mt-6"
          onClick={() => {
            onNext();
          }}
        >
          Continue to starting work
        </Button>
      </Surface>
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
      <Button
        type="button"
        variant="secondary"
        className="mt-6 ml-3 sm:ml-0"
        onClick={() => {
          navigation.selectSection('review');
        }}
      >
        Review this definition
      </Button>
    </TabPanel>
  );
}
