'use client';
import { type JSX, type ReactNode } from 'react';
import { Button, Surface } from '@docket/ui/primitives';
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
    <>
      <Surface
        as="header"
        data-template-definition-header=""
        tone="prominent"
        shape="medium"
        pad="comfortable"
        className="sticky top-2 z-10 flex min-w-0 flex-col gap-2 sm:p-5"
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
      {section === 'review' ? (
        <div
          role="tabpanel"
          id="tabpanel-review"
          className="flex min-w-0 scroll-mt-48 flex-col gap-6"
          aria-labelledby="tab-review"
        >
          {reviewIntro}
          <WorkTemplateDefinitionReview orgId={orgId} form={form} templateId={initial?.id} />
          {children}
        </div>
      ) : null}
    </>
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
    <div
      hidden={hidden}
      role="tabpanel"
      id="tabpanel-work"
      aria-labelledby="tab-work"
      onFocusCapture={onFocusCapture}
      className="scroll-mt-48"
    >
      <WorkTemplateFields orgId={orgId} form={form} isBase={initial?.isBase ?? false} />
      <Button
        type="button"
        variant="secondary"
        className="mt-6"
        onClick={() => {
          onReview();
        }}
      >
        Continue to included work
      </Button>
    </div>
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
    <div
      hidden={hidden}
      role="tabpanel"
      id="tabpanel-purpose"
      onFocusCapture={onFocusCapture}
      className="scroll-mt-48"
      aria-labelledby="tab-purpose"
    >
      <Surface tone="card" shape="medium" pad="roomy" className="sm:p-6">
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
    </div>
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
    <div
      hidden={navigation.section !== 'structure'}
      role="tabpanel"
      id="tabpanel-structure"
      aria-labelledby="tab-structure"
      onFocusCapture={navigation.rememberFocus}
      className="scroll-mt-48"
    >
      <WorkTemplateBlueprintFields orgId={orgId} form={form} />
      <Button
        type="button"
        variant="secondary"
        className="mt-6"
        onClick={() => {
          navigation.selectSection('review');
        }}
      >
        Review this definition
      </Button>
    </div>
  );
}
