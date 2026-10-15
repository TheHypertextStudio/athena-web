'use client';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@docket/ui/primitives';
import type {
  BlueprintCreationOptions,
  BlueprintCreationPreview,
  BlueprintPreviewOptions,
} from '@docket/work/work-template-blueprint';
import { useApiQuery } from '@/lib/query';
import { UserFacingError, userErrorMessage, readProblemError } from '@/lib/problem';
import { workTemplatesDef } from '@/components/templates/work-template-queries';
import { BlueprintCreationPreviewDialog } from './blueprint-creation-preview';
import {
  blueprintCreationTeamsDef,
  useBlueprintPreview,
  type BlueprintPreviewRequest,
} from './blueprint-preview-queries';
import type { WorkTemplateDraftFields } from './work-template-draft';

const emptyOptions: BlueprintPreviewOptions = { optionalChoices: [] };
interface ReviewProps {
  orgId: string;
  kind: BlueprintPreviewRequest['kind'];
  request: () => BlueprintPreviewRequest | null;
  selection: WorkTemplateDraftFields;
  setField: (field: 'blueprint', options: BlueprintCreationOptions) => void;
  disabled?: boolean;
}
function requireRequest(props: ReviewProps): BlueprintPreviewRequest {
  const request = props.request();
  if (!request) throw new UserFacingError('Choose a team before reviewing included work.');
  return request;
}

function withoutReview(request: BlueprintPreviewRequest): BlueprintPreviewRequest {
  request = { ...request, options: emptyOptions, summaryOffset: 0 };
  switch (request.kind) {
    case 'task':
      return { ...request, body: { ...request.body, blueprint: undefined } };
    case 'project':
      return { ...request, body: { ...request.body, blueprint: undefined } };
    case 'initiative':
      return { ...request, body: { ...request.body, blueprint: undefined } };
    case 'program':
      return { ...request, body: { ...request.body, blueprint: undefined } };
  }
}

/** One review lifecycle shared by all four composers, retaining the draft after refusal or cancellation. */
export function useBlueprintCreationReview(props: ReviewProps): {
  ensureReviewed: () => Promise<boolean>;
  review: () => Promise<void>;
  dialog: ReactNode;
  readFailure: (response: Response, fallback: string) => Promise<string>;
} {
  const { orgId, kind, selection } = props;
  const definitions = useApiQuery(workTemplatesDef(orgId, { targetType: kind }));
  const teamless = kind === 'program' || kind === 'initiative';
  const teams = useApiQuery({ ...blueprintCreationTeamsDef(orgId), enabled: teamless });
  const mutation = useBlueprintPreview(orgId);
  const controller = useReviewController(props, async (input, offset) => {
    const request = props.request();
    if (!request) throw new UserFacingError('Choose a team before reviewing included work.');
    const templates = definitions.data ?? (await definitions.refetch()).data;
    const id = selection.workTypeId ?? templates?.items.find((item) => item.isBase)?.id;
    if (!id) throw new UserFacingError('Could not load the template. Try again.');
    return mutation.mutateAsync({
      id,
      request: { ...withoutReview(request), options: input, summaryOffset: offset },
    });
  });
  return {
    ensureReviewed: controller.ensureReviewed,
    review: controller.review,
    readFailure: (response, fallback) =>
      readBlueprintFailure(response, controller.review, fallback),
    dialog: (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.disabled === true || mutation.isPending}
          onClick={() => {
            void controller.review();
          }}
        >
          Review included work
        </Button>
        <BlueprintCreationPreviewDialog
          open={controller.open}
          preview={controller.preview}
          options={controller.options}
          pending={
            mutation.isPending ||
            (controller.preview !== null && !controller.ready && !controller.error)
          }
          error={controller.error}
          teams={teams.data?.items ?? []}
          teamless={teamless}
          onClose={controller.close}
          onChange={(input) => {
            void controller.change(input);
          }}
          onPage={(offset) => {
            void controller.change(controller.options, offset);
          }}
          onAccept={controller.accept}
        />
      </>
    ),
  };
}

async function readBlueprintFailure(
  response: Response,
  review: () => Promise<void>,
  fallback: string,
): Promise<string> {
  const problem = await readProblemError(response, fallback);
  if (problem.code === 'blueprint_preview_stale') {
    await review();
    return 'The included work changed. Review it again before creating your work.';
  }
  return userErrorMessage(problem, fallback);
}

function useReviewController(
  props: ReviewProps,
  fetchPreview: (
    options: BlueprintPreviewOptions,
    offset: number,
  ) => Promise<BlueprintCreationPreview>,
) {
  const [preview, setPreview] = useState<BlueprintCreationPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<BlueprintPreviewOptions>(emptyOptions);
  const [error, setError] = useState<string | null>(null);
  const accepted = useRef<string | null>(null);
  const reviewed = useRef<string | null>(null);
  function key(input: BlueprintPreviewOptions): string {
    return JSON.stringify({
      orgId: props.orgId,
      request: props.request() ? withoutReview(requireRequest(props)) : null,
      choices: input.optionalChoices,
      creationTeamId: input.creationTeamId,
    });
  }
  async function load(
    input: BlueprintPreviewOptions,
    offset = 0,
  ): Promise<BlueprintCreationPreview> {
    const result = await fetchPreview(input, offset);
    setPreview(result);
    setOptions(input);
    setError(null);
    reviewed.current = key(input);
    return result;
  }
  async function change(input: BlueprintPreviewOptions, offset = 0): Promise<void> {
    setOptions(input);
    reviewed.current = null;
    try {
      await load(input, offset);
    } catch (caught) {
      setError(reviewError(caught));
    }
  }
  async function review(): Promise<void> {
    setOpen(true);
    await change(props.selection.blueprint ?? emptyOptions);
  }
  async function ensureReviewed(): Promise<boolean> {
    const input = props.selection.blueprint ?? emptyOptions;
    if (accepted.current === key(input)) return true;
    const result = await load(input);
    if (result.descendantCount === 0) return true;
    setOpen(true);
    return false;
  }
  function accept(): void {
    if (!preview || !reviewed.current || error) return;
    if (reviewed.current !== key(options)) {
      setError('The draft changed. Review included work again before keeping these choices.');
      return;
    }
    accepted.current = reviewed.current;
    props.setField('blueprint', { ...options, previewToken: preview.previewToken });
    setOpen(false);
  }
  return {
    preview,
    open,
    ready: reviewed.current !== null,
    options,
    error,
    ensureReviewed,
    review,
    change,
    accept,
    close: () => {
      setOpen(false);
    },
  };
}

function reviewError(caught: unknown): string {
  return userErrorMessage(
    caught,
    'Could not review these choices. Check the destination, parents and prerequisites, then try again.',
  );
}
