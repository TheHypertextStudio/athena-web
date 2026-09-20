'use client';

import { Button, ControlGroup, DialogBody, DialogHeader, Tabs } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type ReactNode, type RefObject } from 'react';

import { DocumentContentsRail, type DocumentContents } from '@/components/editor/document-contents';
import MentionHydrationProvider from '@/components/mentions/mention-hydration';
import { EntityMetadataRow } from '@/components/views/entity-detail-layout';

import { ComposerClosePrompt, type ComposerClosePromptProps } from './composer-close-prompt';
import { ComposerDraftsChip } from './composer-drafts-chip';
import type { ComposerContinuation, ComposerSupplementalSection } from './composer-shell';
import type { ComposerDraftControls } from './use-composer-draft-persistence';

/** Props for the identity fields and optional section switcher above a composer body. */
interface ComposerIdentityHeaderProps {
  readonly contextRow?: ReactNode | undefined;
  readonly icon?: ReactNode | undefined;
  readonly context?: ReactNode | undefined;
  readonly legacyContextVisible: boolean;
  readonly bodyPlaceholder?: string | undefined;
  readonly leadingFields?: ReactNode | undefined;
  readonly editDisabled: boolean;
  readonly title: string;
  readonly onTitleChange: (title: string) => void;
  readonly titleInputRef?: RefObject<HTMLInputElement | null> | undefined;
  readonly titlePlaceholder: string;
  readonly summary?: string | undefined;
  readonly onSummaryChange?: ((summary: string) => void) | undefined;
  readonly summaryPlaceholder?: string | undefined;
  readonly summaryMaxLength?: number | undefined;
  readonly hasSectionSwitcher: boolean;
  readonly activeSectionValue: string;
  readonly onSectionValueChange: (value: string) => void;
  readonly supplementalSections: readonly ComposerSupplementalSection[];
  readonly sectionValue: (sectionId: string) => string;
}

/** Render either the current metadata-row context or the legacy icon-and-label context. */
function ComposerContext({
  contextRow,
  icon,
  context,
  legacyContextVisible,
}: Pick<
  ComposerIdentityHeaderProps,
  'context' | 'contextRow' | 'icon' | 'legacyContextVisible'
>): JSX.Element | null {
  if (contextRow !== undefined) {
    return (
      <div data-composer-context-row="" className="min-w-0">
        <EntityMetadataRow ariaLabel="Composer context" className="text-label-large min-w-0">
          {contextRow}
        </EntityMetadataRow>
      </div>
    );
  }
  if (!icon && !context) return null;
  return (
    <div
      className={cn(
        'text-body-small flex items-center gap-2 pr-16 has-[>div:only-child:empty]:hidden',
        !legacyContextVisible && 'hidden',
      )}
    >
      {icon ? (
        <span className="bg-surface-container-highest text-on-surface-variant flex size-5 shrink-0 items-center justify-center rounded-md [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      {context ? <span className="text-on-surface-variant min-w-0 truncate">{context}</span> : null}
    </div>
  );
}

/** Render the section switcher only when the composer declares supplemental body content. */
function ComposerSectionTabs({
  hasSectionSwitcher,
  activeSectionValue,
  onSectionValueChange,
  supplementalSections,
  sectionValue,
}: Pick<
  ComposerIdentityHeaderProps,
  | 'activeSectionValue'
  | 'hasSectionSwitcher'
  | 'onSectionValueChange'
  | 'sectionValue'
  | 'supplementalSections'
>): JSX.Element | null {
  if (!hasSectionSwitcher) return null;
  return (
    <ControlGroup controlSize="sm" className="mt-3 self-start">
      <Tabs
        value={activeSectionValue}
        onValueChange={onSectionValueChange}
        label="Composer sections"
        items={[
          { value: sectionValue('description'), label: 'Description' },
          ...supplementalSections.map((section) => ({
            value: sectionValue(section.id),
            label: section.label,
            ariaLabel: section.accessibleLabel,
            ...(section.count === undefined ? {} : { count: section.count }),
          })),
        ]}
      />
    </ControlGroup>
  );
}

/** Keep optional template fields disabled on the same terms as the rest of the draft. */
function ComposerLeadingFields({
  children,
  disabled,
}: {
  readonly children?: ReactNode | undefined;
  readonly disabled: boolean;
}): JSX.Element | null {
  if (!children) return null;
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3 pb-4">
      {children}
    </fieldset>
  );
}

/** Render the composer's destination, identity fields, and compact body-section switcher. */
export function ComposerIdentityHeader({
  contextRow,
  icon,
  context,
  legacyContextVisible,
  bodyPlaceholder,
  leadingFields,
  editDisabled,
  title,
  onTitleChange,
  titleInputRef,
  titlePlaceholder,
  summary,
  onSummaryChange,
  summaryPlaceholder,
  summaryMaxLength,
  hasSectionSwitcher,
  activeSectionValue,
  onSectionValueChange,
  supplementalSections,
  sectionValue,
}: ComposerIdentityHeaderProps): JSX.Element {
  return (
    <DialogHeader
      inset="responsive"
      controls={bodyPlaceholder !== undefined ? 'responsive-two' : 'one'}
      className="min-w-0"
    >
      <ComposerContext
        contextRow={contextRow}
        icon={icon}
        context={context}
        legacyContextVisible={legacyContextVisible}
      />

      <div
        className={cn(
          'flex min-h-0 flex-col',
          contextRow !== undefined || legacyContextVisible ? 'pt-3' : '',
        )}
      >
        <ComposerLeadingFields disabled={editDisabled}>{leadingFields}</ComposerLeadingFields>

        <div className="flex flex-col gap-1">
          <input
            aria-label={titlePlaceholder}
            placeholder={titlePlaceholder}
            value={title}
            ref={titleInputRef}
            disabled={editDisabled}
            autoFocus
            onChange={(event) => {
              onTitleChange(event.target.value);
            }}
            className="placeholder:text-on-surface-variant text-on-surface text-headline-small w-full bg-transparent outline-none disabled:opacity-50"
          />
          {onSummaryChange ? (
            <input
              aria-label={summaryPlaceholder ?? 'Summary'}
              placeholder={summaryPlaceholder}
              maxLength={summaryMaxLength}
              value={summary ?? ''}
              disabled={editDisabled}
              onChange={(event) => {
                onSummaryChange(event.target.value);
              }}
              className="placeholder:text-on-surface-variant text-on-surface-variant text-body-large w-full bg-transparent outline-none disabled:opacity-50"
            />
          ) : null}
        </div>
        <ComposerSectionTabs
          hasSectionSwitcher={hasSectionSwitcher}
          activeSectionValue={activeSectionValue}
          onSectionValueChange={onSectionValueChange}
          supplementalSections={supplementalSections}
          sectionValue={sectionValue}
        />
      </div>
    </DialogHeader>
  );
}

/** Props for {@link ComposerBodyRegion}. */
interface ComposerBodyRegionProps {
  readonly editor: ReactNode;
  readonly mentionOrgId?: string | undefined;
  readonly columnRef: RefObject<HTMLDivElement | null>;
  readonly contents: DocumentContents;
  readonly hasContents: boolean;
  readonly freeformFields: ReactNode;
  readonly supplementalSections: readonly ComposerSupplementalSection[];
  readonly activeSectionId: string;
  readonly sectionValue: (sectionId: string) => string;
  readonly editDisabled: boolean;
}

/** Render one full-height body section while keeping every section mounted. */
export function ComposerBodyRegion({
  editor,
  mentionOrgId,
  columnRef,
  contents,
  hasContents,
  freeformFields,
  supplementalSections,
  activeSectionId,
  sectionValue,
  editDisabled,
}: ComposerBodyRegionProps): JSX.Element {
  const descriptionValue = sectionValue('description');
  return (
    <DialogBody
      inset="responsive-inline"
      scroll="hidden"
      data-composer-body=""
      className="@container grid min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)]"
    >
      <section
        role="tabpanel"
        id={`tabpanel-${descriptionValue}`}
        aria-labelledby={`tab-${descriptionValue}`}
        aria-hidden={activeSectionId !== 'description'}
        inert={activeSectionId !== 'description'}
        className={cn(
          'col-start-1 row-start-1 min-h-0',
          activeSectionId !== 'description' && 'pointer-events-none opacity-0',
        )}
      >
        <div
          className={cn(
            'grid h-full min-h-0 grid-rows-[minmax(0,1fr)] gap-4',
            hasContents && '@2xl:grid-cols-[minmax(0,1fr)_11rem]',
          )}
        >
          <div ref={columnRef} className="flex min-w-0 flex-col gap-4">
            {mentionOrgId === undefined ? (
              editor
            ) : (
              <MentionHydrationProvider orgId={mentionOrgId}>{editor}</MentionHydrationProvider>
            )}
            {freeformFields}
          </div>

          {hasContents ? (
            <div className="entity-contents-desktop hidden @2xl:block">
              <DocumentContentsRail contents={contents} showLabel density="compact" />
            </div>
          ) : null}
        </div>
      </section>

      {supplementalSections.map((section) => {
        const value = sectionValue(section.id);
        return (
          <section
            key={section.id}
            role="tabpanel"
            id={`tabpanel-${value}`}
            aria-labelledby={`tab-${value}`}
            aria-hidden={activeSectionId !== section.id}
            inert={activeSectionId !== section.id}
            className={cn(
              'col-start-1 row-start-1 min-h-0 overflow-y-auto overscroll-contain',
              activeSectionId !== section.id && 'pointer-events-none opacity-0',
            )}
          >
            <fieldset disabled={editDisabled} className="flex min-h-full flex-col">
              {section.body}
            </fieldset>
          </section>
        );
      })}
    </DialogBody>
  );
}

/** Props for {@link ComposerActionRow}. */
interface ComposerActionRowProps {
  readonly confirmingDiscard: boolean;
  readonly onKeepEditing: () => void;
  readonly onDiscard: () => void;
  readonly drafts?: ComposerDraftControls | undefined;
  readonly draftNoun: string;
  readonly continuation?: ComposerContinuation | undefined;
  readonly editDisabled: boolean;
  readonly formId: string;
  readonly creating: boolean;
  readonly canSubmit: boolean;
  readonly submitLabel: string;
}

/** Render ordinary composer actions or the inline discard confirmation. */
export function ComposerActionRow({
  confirmingDiscard,
  onKeepEditing,
  onDiscard,
  drafts,
  draftNoun,
  continuation,
  editDisabled,
  formId,
  creating,
  canSubmit,
  submitLabel,
}: ComposerActionRowProps): JSX.Element {
  if (confirmingDiscard) {
    return (
      <ComposerClosePrompt
        onKeepEditing={onKeepEditing}
        {...closePromptAnswers(drafts, onDiscard)}
      />
    );
  }

  return (
    <div className="flex w-full flex-row items-center gap-2">
      {drafts ? (
        <ComposerDraftsChip drafts={drafts} noun={draftNoun} disabled={editDisabled} />
      ) : null}
      {continuation ? (
        <button
          type="button"
          role="switch"
          aria-checked={continuation.checked}
          disabled={editDisabled}
          onClick={() => {
            continuation.onCheckedChange(!continuation.checked);
          }}
          className="text-on-surface-variant hover:bg-surface-container-high text-label-large coarse:min-h-10 mr-auto inline-flex h-8 items-center gap-2 rounded-md px-2 whitespace-nowrap disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className={cn(
              'bg-outline-variant inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors',
              continuation.checked && 'bg-primary justify-end',
            )}
          >
            <span className="bg-surface h-3 w-3 rounded-full" />
          </span>
          Create more
        </button>
      ) : null}
      <Button
        type="submit"
        form={formId}
        disabled={creating || !canSubmit}
        aria-busy={creating}
        className={cn(
          'disabled:bg-surface-container-highest disabled:text-on-surface-variant disabled:opacity-100',
          !continuation && 'ml-auto',
        )}
      >
        {creating ? 'Creating…' : submitLabel}
      </Button>
    </div>
  );
}

/** Resolve close-prompt actions through saved-draft persistence when it is available. */
function closePromptAnswers(
  drafts: ComposerDraftControls | undefined,
  close: () => void,
): Pick<ComposerClosePromptProps, 'onDiscard' | 'onSave'> {
  if (!drafts) return { onDiscard: close };
  return {
    onDiscard: () => {
      void drafts.onDiscard().then(close);
    },
    onSave: () => {
      void drafts.onKeep().then(close);
    },
  };
}

/** Render the measured row of compact property pills. */
export function PropertyStrip({
  ariaLabel,
  children,
}: {
  readonly ariaLabel: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <EntityMetadataRow
      ariaLabel={ariaLabel}
      className="[&_[data-entity-metadata-inline]_button]:bg-surface-container-highest [&_[data-entity-metadata-inline]_button:hover]:bg-secondary-container [&_[data-entity-metadata-inline]_button:hover]:text-on-secondary-container [&_[data-entity-metadata-inline]_button]:rounded-full"
    >
      {children}
    </EntityMetadataRow>
  );
}
