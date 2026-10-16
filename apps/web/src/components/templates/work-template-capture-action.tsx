'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { Button } from '@docket/ui/primitives';
import { useState, type JSX, type ReactNode } from 'react';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { workTemplateHref } from '@/components/templates/work-template-navigation';
import { useApiQuery } from '@/lib/query';
import { useAppRouter } from '@/lib/interactions/navigation';
import { UserFacingError } from '@/lib/problem';
import {
  captureAuthoringPolicyDef,
  workTemplateCapturePreviewDef,
  useWorkTemplateCapture,
} from './work-template-capture-queries';
import { WorkTemplateCaptureDialog } from './work-template-capture-dialog';

function useCapturePermission(orgId: string): boolean {
  const permission = useCanManageOrg(orgId);
  const policy = useApiQuery(captureAuthoringPolicyDef(orgId));
  if (permission.loading || policy.isPending || policy.isError) return false;
  return policy.data.workTemplateAuthoring === 'admins'
    ? permission.canManage
    : permission.canContribute;
}

/** Independent Save-as action for an authorized source viewer; it never requires source edit rights. */
export function WorkTemplateCaptureAction({
  orgId,
  kind,
  workId,
  renderTrigger,
}: {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly workId: string;
  readonly renderTrigger?: (open: (() => void) | undefined) => ReactNode;
}): JSX.Element | null {
  const allowed = useCapturePermission(orgId);
  const [open, setOpen] = useState(false);
  const [authoredName, setAuthoredName] = useState<string | null>(null);
  const [failure, setFailure] = useState<'stale' | 'failed' | null>(null);
  const preview = useApiQuery(workTemplateCapturePreviewDef(orgId, kind, workId, open && allowed));
  const mutation = useWorkTemplateCapture(orgId, kind, workId);
  const router = useAppRouter();
  const name = authoredName ?? preview.data?.definition.name ?? '';
  const ready =
    Boolean(preview.data) &&
    !preview.isPending &&
    !preview.isFetching &&
    !preview.isError &&
    failure !== 'stale';
  const save = async (): Promise<void> => {
    if (!ready || !name.trim()) return;
    setFailure(null);
    try {
      const result = await mutation.mutateAsync({
        name,
        sourceSnapshotToken: preview.data.sourceSnapshotToken,
      });
      setOpen(false);
      router.push(`${workTemplateHref(orgId)}/${result.template.id}`);
    } catch (error) {
      setFailure(error instanceof UserFacingError && error.status === 409 ? 'stale' : 'failed');
    }
  };
  const openCapture = (): void => {
    mutation.reset();
    setFailure(null);
    setOpen(true);
  };
  if (!allowed) return <CaptureTrigger renderTrigger={renderTrigger} />;
  return (
    <>
      <CaptureTrigger renderTrigger={renderTrigger} onOpen={openCapture} />
      <WorkTemplateCaptureDialog
        open={open}
        name={name}
        preview={preview.data}
        ready={ready}
        loading={preview.isPending || preview.isFetching}
        previewFailed={preview.isError}
        pending={mutation.isPending}
        failure={failure}
        onNameChange={setAuthoredName}
        onClose={() => {
          setOpen(false);
        }}
        onSave={() => {
          void save();
        }}
        onRefresh={() => {
          setFailure(null);
          void preview.refetch();
        }}
      />
    </>
  );
}

function CaptureTrigger({
  renderTrigger,
  onOpen,
}: {
  readonly renderTrigger: ((open: (() => void) | undefined) => ReactNode) | undefined;
  readonly onOpen?: () => void;
}): JSX.Element | null {
  if (renderTrigger) return <>{renderTrigger(onOpen)}</>;
  return onOpen ? (
    <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
      Save as template
    </Button>
  ) : null;
}
