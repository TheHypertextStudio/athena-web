'use client';

/**
 * `settings` — the recovery-codes generation dialog.
 *
 * @remarks
 * The deliberate gate before (re)generating account recovery codes. Generating is a high-risk
 * action, so it's behind a **passkey re-verification** ({@link useReauth}) fired on confirm — a
 * hijacked or unattended session can't silently mint codes. The dialog has two phases: a **confirm**
 * phase (which warns that regenerating invalidates the previous codes) and a **reveal** phase that
 * shows the freshly generated codes exactly once, with copy + download. Codes are generated via
 * Docket's REST endpoint (`POST /v1/me/recovery-codes`), which replaces any existing set and is
 * gated server-side on the fresh passkey session. A failed step-up or write becomes a notice.
 * Closing after a successful reveal calls {@link RecoveryCodesDialogProps.onGenerated} so the
 * Security tab refetches the remaining count.
 */
import { RecoveryCodesOut } from '@docket/identity-access/account-contract';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { presentFailure } from '@/components/feedback';
import { api } from '@/lib/api';
import { unwrap } from '@/lib/query';

import { useReauth } from './use-reauth';

/** What the notice says when generating fails without a more specific reason. */
const GENERATE_FAILED = 'Could not generate recovery codes.';

/** Whether the user is generating codes for the first time or replacing an existing set. */
export type RecoveryCodesMode = 'generate' | 'regenerate';

/** Props for {@link RecoveryCodesDialog}. */
export interface RecoveryCodesDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open/close handler (also fired on overlay/escape dismiss). */
  onOpenChange: (open: boolean) => void;
  /** First-time generation vs. replacing existing codes (drives the warning + which call runs). */
  mode: RecoveryCodesMode;
  /** Called after a successful reveal is dismissed, so the caller can refetch the status. */
  onGenerated: () => void;
}

/** (Re)generate codes via Docket's REST endpoint and return the plaintext set (throws on failure). */
async function generateCodes(): Promise<string[]> {
  const data = await unwrap(
    () => api.v1.me['recovery-codes'].$post(),
    'Could not generate recovery codes.',
  );
  return RecoveryCodesOut.parse(data).codes;
}

/** Serialize codes into a dated plain-text file the user can download as a backup. */
function downloadCodes(codes: string[]): void {
  const blob = new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `docket-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** What the dialog says it is about, which depends on why it opened and how far it has got. */
function IntroCopy({
  revealed,
  mode,
}: {
  readonly revealed: boolean;
  readonly mode: RecoveryCodesDialogProps['mode'];
}): JSX.Element {
  if (revealed) {
    return (
      <>
        Store these somewhere safe — a password manager is ideal. Each code works once to get back
        into your account if you lose your passkey. You won&apos;t be able to see them again.
      </>
    );
  }
  if (mode === 'regenerate') {
    return (
      <>
        This replaces your current recovery codes — any you saved before will stop working.
        You&apos;ll re-verify your passkey first.
      </>
    );
  }
  return (
    <>
      Recovery codes let you get back into your account if you lose your passkey. You&apos;ll
      re-verify your passkey, then we&apos;ll show you a fresh set to save.
    </>
  );
}

/** The one-time listing of generated codes, numbered so a reader can check they copied them all. */
function RevealedCodes({ codes }: { readonly codes: readonly string[] }): JSX.Element {
  return (
    <>
      <ol className="bg-surface-container text-body-medium grid grid-cols-2 gap-x-6 gap-y-1 rounded-md p-4 font-mono">
        {codes.map((code, i) => (
          <li key={code} className="text-on-surface flex gap-2 tabular-nums">
            <span className="text-on-surface-variant w-5 shrink-0 text-right select-none">
              {i + 1}.
            </span>
            {code}
          </li>
        ))}
      </ol>
      <p className="text-on-surface-variant text-body-small">
        Copy or download your codes — you won&apos;t see them again.
      </p>
    </>
  );
}

/** The recovery-codes (re)generation dialog (passkey step-up → reveal codes once). */
export function RecoveryCodesDialog({
  open,
  onOpenChange,
  mode,
  onGenerated,
}: RecoveryCodesDialogProps): JSX.Element {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const reauth = useReauth();

  function close(next: boolean): void {
    if (busy) return; // don't dismiss mid-request
    if (!next) {
      const revealed = codes !== null;
      setCodes(null);
      setCopied(false);
      setDownloaded(false);
      if (revealed) onGenerated();
    }
    onOpenChange(next);
  }

  async function onConfirm(): Promise<void> {
    setBusy(true);
    try {
      // Step-up: re-verify the passkey (mints a fresh session so the server's fresh-session gate
      // passes), then (re)generate via Docket's REST endpoint.
      await reauth();
      setCodes(await generateCodes());
    } catch (caught) {
      presentFailure(caught, GENERATE_FAILED);
    } finally {
      setBusy(false);
    }
  }

  async function onCopy(): Promise<void> {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const revealed = codes !== null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>
            {revealed ? 'Save your recovery codes' : 'Generate recovery codes'}
          </DialogTitle>
          <DialogDescription>
            <IntroCopy revealed={revealed} mode={mode} />
          </DialogDescription>
        </DialogHeader>

        {/* A full set of codes can outrun the panel, so this is the region that scrolls. */}
        {codes !== null ? (
          <DialogBody className="flex flex-col gap-2">
            <RevealedCodes codes={codes} />
          </DialogBody>
        ) : null}

        <DialogFooter>
          {revealed ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void onCopy();
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  downloadCodes(codes);
                  setDownloaded(true);
                }}
              >
                Download
              </Button>
              <Button
                type="button"
                disabled={!copied && !downloaded}
                onClick={() => {
                  close(false);
                }}
              >
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  close(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  void onConfirm();
                }}
              >
                {busy
                  ? 'Verifying…'
                  : mode === 'regenerate'
                    ? 'Regenerate codes'
                    : 'Generate codes'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
