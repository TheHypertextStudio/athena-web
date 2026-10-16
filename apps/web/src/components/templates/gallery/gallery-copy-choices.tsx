'use client';
import type { JSX } from 'react';
import { LabelId } from '@docket/work/ids';
import { TeamId } from '@docket/identity-access/ids';
import type {
  WorkTemplateGalleryItem,
  WorkTemplateGalleryPreview,
  WorkTemplateGalleryPreviewRequest,
} from '@docket/work/template-gallery-contract';
import { Field, Select } from '@docket/ui/primitives';
import { EntityMultiPicker } from '@docket/ui/components';
import { gallerySourceKey } from './gallery-metadata';

/** Actual destination choices and current policy, supplied by the existing authorized picker services. */
export interface GalleryCopyChoicesProps {
  readonly request: WorkTemplateGalleryPreviewRequest;
  readonly preview: WorkTemplateGalleryPreview;
  readonly selectedItems: readonly WorkTemplateGalleryItem[];
  readonly labelOptions: readonly { readonly value: string; readonly label: string }[];
  readonly teamOptions: readonly { readonly value: string; readonly label: string }[];
  readonly canManageOfferings: boolean;
  readonly disabled: boolean;
  readonly onChange: (request: WorkTemplateGalleryPreviewRequest) => void;
}
function LabelChoice({
  props,
  item,
  suggestion,
}: {
  readonly props: GalleryCopyChoicesProps;
  readonly item: WorkTemplateGalleryItem;
  readonly suggestion: string;
}): JSX.Element {
  const existing = props.request.labels.find(
    (choice) => choice.sourceSlug === item.slug && choice.suggestion === suggestion,
  );
  return (
    <Field
      label={`Map ${suggestion} for ${item.name}`}
      description="Choose an existing destination label, or leave it out."
    >
      <Select
        disabled={props.disabled}
        value={existing?.destinationLabelId ?? ''}
        onChange={(event) => {
          const labels = props.request.labels.filter(
            (choice) => choice.sourceSlug !== item.slug || choice.suggestion !== suggestion,
          );
          const option = props.labelOptions.find((entry) => entry.value === event.target.value);
          props.onChange({
            ...props.request,
            labels: option
              ? [
                  ...labels,
                  {
                    sourceSlug: item.slug,
                    suggestion,
                    destinationLabelId: LabelId.parse(option.value),
                  },
                ]
              : labels,
          });
        }}
      >
        <option value="">Leave out</option>
        {props.labelOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
function OfferingChoice({
  props,
  item,
}: {
  readonly props: GalleryCopyChoicesProps;
  readonly item: WorkTemplateGalleryItem;
}): JSX.Element {
  const existing =
    props.request.offerings.find((choice) => choice.sourceSlug === item.slug)?.teamIds ?? [];
  return (
    <Field
      label={`Offer ${item.name} in team creation menus`}
      description={
        props.canManageOfferings
          ? 'Leave this empty to offer this template to every team.'
          : 'An administrator can choose teams. No team is assigned automatically.'
      }
    >
      <EntityMultiPicker
        options={props.teamOptions}
        value={existing}
        singularLabel="team"
        pluralLabel="teams"
        ariaLabel={`Offer ${item.name} to teams`}
        placeholder="Every team"
        disabled={props.disabled || !props.canManageOfferings}
        onToggle={(id) => {
          const team = props.teamOptions.find((option) => option.value === id);
          if (!team) return;
          const teamId = TeamId.parse(team.value);
          const offerings = props.request.offerings.filter(
            (choice) => choice.sourceSlug !== item.slug,
          );
          props.onChange({
            ...props.request,
            offerings: [
              ...offerings,
              {
                sourceSlug: item.slug,
                teamIds: existing.includes(teamId)
                  ? existing.filter((value) => value !== teamId)
                  : [...existing, teamId],
              },
            ],
          });
        }}
      />
    </Field>
  );
}
function labelChoices(
  props: GalleryCopyChoicesProps,
): { item: WorkTemplateGalleryItem; suggestion: string }[] {
  const entries = new Map<string, { item: WorkTemplateGalleryItem; suggestion: string }>();
  for (const omission of props.preview.omissions) {
    const item = props.selectedItems.find(
      (entry) => gallerySourceKey(entry.identity) === gallerySourceKey(omission.source),
    );
    if (item && omission.kind === 'label_suggestion' && omission.value)
      entries.set(`${item.slug}:${omission.value}`, { item, suggestion: omission.value });
  }
  for (const choice of props.request.labels) {
    const item = props.selectedItems.find((entry) => entry.slug === choice.sourceSlug);
    if (item)
      entries.set(`${item.slug}:${choice.suggestion}`, { item, suggestion: choice.suggestion });
  }
  return [...entries.values()];
}
function offeringItems(props: GalleryCopyChoicesProps): WorkTemplateGalleryItem[] {
  return props.selectedItems.filter(
    (item) =>
      props.request.offerings.some((choice) => choice.sourceSlug === item.slug) ||
      props.preview.omissions.some(
        (omission) =>
          omission.kind === 'offering_suggestion' &&
          gallerySourceKey(omission.source) === gallerySourceKey(item.identity),
      ),
  );
}
/** Require explicit destination mapping; catalog suggestions never become labels or teams by name. */
export function GalleryCopyChoices(props: GalleryCopyChoicesProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {labelChoices(props).map(({ item, suggestion }) => (
        <LabelChoice
          key={`${item.slug}:${suggestion}`}
          props={props}
          item={item}
          suggestion={suggestion}
        />
      ))}
      {offeringItems(props).map((item) => (
        <OfferingChoice key={item.slug} props={props} item={item} />
      ))}
    </div>
  );
}
