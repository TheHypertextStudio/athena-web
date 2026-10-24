'use client';
import type { JSX, ReactNode } from 'react';
import { InlineBanner } from '@docket/ui/components';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import type { WorkTemplateFormState } from './use-work-template-form';
import type { TemplateDefinitionSection } from './use-template-section-navigation';
import type { TemplateAuthoringMode } from './work-template-authoring-route';
import { useTemplateAuthoringFlow } from './use-template-authoring-flow';
import { TemplateEditorSelectionContext } from './template-editor-selection';
import { TemplateAuthoringContext } from './template-authoring-context';
import { TemplateDefinitionSections } from './template-definition-sections';
import {
  TemplateDefinitionAction,
  TemplateCreationFooter,
  TemplateReviewAction,
  TemplatePublicationConsequence,
} from './template-definition-action';
import {
  TemplatePublishedHistory,
  TemplatePublicationActions,
} from './template-publication-management';
import {
  TemplatePublicationReadiness,
  useTemplatePublicationReadiness,
} from './work-template-publication-readiness';

/** Route and render intent stay outside the saved template definition. */
export interface WorkTemplateFormProps {
  orgId: string;
  initial: WorkTemplateOut | null;
  onCreated: (
    id: string,
    section?: TemplateDefinitionSection,
    created?: WorkTemplateOut,
    reached?: number,
  ) => void;
  mode?: TemplateAuthoringMode;
  onFinish?: () => void;
  renderActivity?: (content: ReactNode, footer?: ReactNode) => JSX.Element;
  returnContext?: string;
  initialSection?: TemplateDefinitionSection | undefined;
  initialReached?: number;
}

type AuthoringFlow = ReturnType<typeof useTemplateAuthoringFlow>;

/** Failed writes preserve the editable draft; publication is a separate explicit action. */
export function WorkTemplateForm(props: WorkTemplateFormProps): JSX.Element {
  const flow = useTemplateAuthoringFlow(props);
  const content = <TemplateFormContent props={props} flow={flow} />;
  const footer =
    flow.mode === 'create' && flow.form.canEdit ? (
      <TemplateCreationFooter
        form={flow.form}
        initial={props.initial}
        section={flow.navigation.section}
        publicationBlocked={flow.publicationBlocked}
        onFinish={() => {
          props.onFinish?.();
        }}
        onBack={flow.back}
        onNext={flow.next}
      />
    ) : null;
  return (
    <TemplateAuthoringContext.Provider value={flow.context}>
      <TemplateEditorSelectionContext.Provider value={flow.selection}>
        {props.renderActivity ? (
          props.renderActivity(content, footer)
        ) : (
          <>
            {content}
            {footer}
          </>
        )}
      </TemplateEditorSelectionContext.Provider>
    </TemplateAuthoringContext.Provider>
  );
}

function TemplateFormContent({
  props,
  flow,
}: {
  props: WorkTemplateFormProps;
  flow: AuthoringFlow;
}): JSX.Element {
  const { orgId, initial } = props;
  const { form, navigation, mode, reached, validation, publicationBlocked } = flow;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {!form.canEdit ? (
        <p className="text-body-small text-on-surface-variant">
          You can read this template, but you don’t have permission to edit it.
        </p>
      ) : null}
      {initial?.isBase ? (
        <p className="text-body-small text-on-surface-variant">
          Every item of this kind can use the blank template. Its name follows your workspace’s
          terminology.
        </p>
      ) : null}
      {validation ? (
        <div
          ref={flow.validationRef}
          role="group"
          aria-label="Section needs attention"
          tabIndex={-1}
        >
          <InlineBanner tone="critical" title="Check this section">
            {validation}
          </InlineBanner>
        </div>
      ) : null}
      <TemplateDefinitionSections
        mode={mode}
        reached={reached}
        orgId={orgId}
        initial={initial}
        form={form}
        navigation={navigation}
        reviewIntro={
          <TemplateReviewPublication
            orgId={orgId}
            initial={initial}
            form={form}
            mode={mode}
            publicationBlocked={publicationBlocked}
          />
        }
        header={
          <TemplateAuthoringHeader
            section={navigation.section}
            initial={initial}
            form={form}
            mode={mode}
          />
        }
      >
        {initial ? (
          <>
            <TemplatePublishedHistory orgId={orgId} id={initial.id} template={initial} visible />
            <TemplatePublicationActions orgId={orgId} initial={initial} form={form} />
          </>
        ) : (
          <p className="text-body-medium text-on-surface-variant">
            Save a private draft to keep this template. Then publish it when your workspace is ready
            to use it.
          </p>
        )}
      </TemplateDefinitionSections>
    </div>
  );
}
function TemplateAuthoringHeader({
  section,
  initial,
  form,
  mode,
}: {
  section: TemplateDefinitionSection;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
  mode: TemplateAuthoringMode;
}): JSX.Element {
  return (
    <>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <TemplateDefinitionIdentity form={form} />
          <TemplateDraftHeader initial={initial} form={form} />
        </div>
        <TemplateDefinitionAction form={form} initial={initial} section={section} mode={mode} />
      </div>
      {form.error ? (
        <InlineBanner tone="critical" title="Couldn't update the template">
          {form.error}
        </InlineBanner>
      ) : null}
    </>
  );
}

function TemplateReviewPublication({
  orgId,
  initial,
  form,
  mode,
  publicationBlocked,
}: {
  mode: TemplateAuthoringMode;
  publicationBlocked: boolean;
  orgId: string;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
}): JSX.Element {
  const readiness = useTemplatePublicationReadiness(orgId, form.definition);
  return (
    <section aria-label="Review and publish" className="flex min-w-0 flex-col gap-3">
      <h2 tabIndex={-1} className="text-title-large">
        Review & publish
      </h2>
      {form.definition.description?.trim() ? (
        <p className="text-body-medium text-on-surface-variant">{form.definition.description}</p>
      ) : null}
      <TemplatePublicationReadiness
        orgId={orgId}
        name={form.definition.name}
        parentId={initial?.id}
        readiness={readiness}
      />
      <TemplatePublicationConsequence form={form} initial={initial} section="review" />
      {mode === 'edit' ? (
        <TemplateReviewAction
          form={form}
          initial={initial}
          mode={mode}
          publicationBlocked={publicationBlocked}
        />
      ) : null}
    </section>
  );
}

function TemplateDefinitionIdentity({ form }: { form: WorkTemplateFormState }): JSX.Element {
  return (
    <div className="min-w-0">
      <h1 className="text-title-large sm:text-headline-large break-words">
        {form.definition.name.trim() ? form.definition.name : 'New work template'}
      </h1>
    </div>
  );
}

function TemplateDraftHeader({
  initial,
  form,
}: {
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
}): JSX.Element {
  return (
    <p className="text-body-small text-on-surface-variant">
      {initial?.status === 'archived'
        ? 'Archived template'
        : initial?.status === 'published'
          ? `Published · Version ${initial.latestVersion?.number ?? 1}`
          : form.scope === 'team'
            ? 'Team draft'
            : 'Private draft · Only you'}
    </p>
  );
}
