'use client';

/**
 * The Athena conversation's composer and its connect dialog.
 *
 * @remarks
 * Split out of `athena-conversation.tsx`. At rest the composer is 96px: a two-row field that grows
 * to six rows and then scrolls, over one 32px row of trailing controls — attach, an optional Talk
 * slot, and send. The composer is a size container: from 560px wide those controls sit inline after
 * the text instead of on their own row. The page chip lives in the panel's header; a host without a
 * header of its own passes it through `chip` instead.
 */
import { ArrowUp, Cable } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  surfaceToneColor,
} from '@docket/ui/primitives';
import { type JSX, type ReactNode, type RefObject } from 'react';

import MentionTextarea from '@/components/mentions/mention-textarea';
import { AddMcpConnectorForm } from '@/components/settings/mcp-connectors-section';

/** Props for {@link Composer}. */
export interface ComposerProps {
  /** Full-page composer has a calmer card treatment and a labeled send action. */
  readonly layout?: 'page' | 'panel';
  /** The form element, so a caller can find its textarea and focus it. */
  readonly composerRef: RefObject<HTMLFormElement | null>;
  /** The page chip, for a host with no header to hold it. */
  readonly chip?: ReactNode;
  /** A Talk control, for a host with no header to hold it. */
  readonly talk?: ReactNode;
  /** The composer's current text. */
  readonly draft: string;
  /** Replace the composer's text. */
  readonly setDraft: (text: string) => void;
  /** Whether a turn is in flight; disables the field and names the send button "Sending". */
  readonly sending: boolean;
  /** The workspace `@` mentions search, or undefined to leave `@` a plain character. */
  readonly mentionOrgId: string | undefined;
  /** Send the current draft. */
  readonly onSend: () => void;
  /** Open the connect dialog. */
  readonly onConnect: () => void;
}

/** The message composer: the mention-aware field and its one row of trailing controls. */
export function Composer({
  composerRef,
  chip,
  talk,
  draft,
  setDraft,
  sending,
  mentionOrgId,
  onSend,
  onConnect,
  layout = 'panel',
}: ComposerProps): JSX.Element {
  return (
    <form
      ref={composerRef}
      aria-label="Message Athena"
      aria-busy={sending}
      className={cn(
        surfaceToneColor('prominent'),
        'focus-within:ring-ring @container flex shrink-0 flex-col rounded-xl p-2 transition-shadow focus-within:ring-2',
        layout === 'page' && 'mx-auto w-full max-w-3xl',
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      {chip ? <div className="px-1 pb-1">{chip}</div> : null}
      {/* From 560px of composer the controls sit inline after the text rather than on a row of
          their own, so a wide composer stays one band instead of a tall slab. */}
      <div
        data-slot="athena-composer-body"
        className="flex flex-col @[560px]:flex-row @[560px]:items-end @[560px]:gap-2"
      >
        <ComposerField
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          mentionOrgId={mentionOrgId}
          onSend={onSend}
        />
        <ComposerControls
          talk={talk}
          sending={sending}
          draft={draft}
          onConnect={onConnect}
          layout={layout}
        />
      </div>
    </form>
  );
}

/** Props for {@link ComposerField}. */
type ComposerFieldProps = Pick<
  ComposerProps,
  'draft' | 'setDraft' | 'sending' | 'mentionOrgId' | 'onSend'
>;

/** The mention-aware field: two rows at rest, six at most, Enter sends. */
function ComposerField({
  draft,
  setDraft,
  sending,
  mentionOrgId,
  onSend,
}: ComposerFieldProps): JSX.Element {
  return (
    <MentionTextarea
      aria-label="Message Athena"
      placeholder="Message Athena"
      rows={2}
      autoGrow
      maxRows={6}
      value={draft}
      disabled={sending}
      onChange={setDraft}
      {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
      insertMode="context"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSend();
        }
      }}
      className="placeholder:text-on-surface-variant text-body-medium min-h-12 w-full min-w-0 resize-none bg-transparent px-2 py-1 outline-none disabled:opacity-50 @[560px]:flex-1"
    />
  );
}

/** Props for {@link ComposerControls}. */
type ComposerControlsProps = Pick<
  ComposerProps,
  'talk' | 'sending' | 'draft' | 'onConnect' | 'layout'
>;

/** The one 32px row of trailing controls: attach, an optional Talk slot, and send. */
function ComposerControls({
  talk,
  sending,
  draft,
  onConnect,
  layout,
}: ComposerControlsProps): JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1">
      {/* There is no "New chat" control, and that is deliberate: a person has one Athena
          conversation, and its topics are derived by {@link AthenaConversationBrowser} rather
          than declared by hand. */}
      <Button
        type="button"
        variant="ghost"
        controlSize="md"
        iconOnly
        aria-label="Connect an app"
        title="Connect an app"
        onClick={onConnect}
      >
        <Cable aria-hidden="true" />
      </Button>
      <div className="ml-auto flex items-center gap-1">
        {talk}
        <Button
          type="submit"
          controlSize="md"
          iconOnly={layout !== 'page'}
          aria-label={sending ? 'Sending' : 'Send'}
          title="Send"
          disabled={sending || draft.trim().length === 0}
        >
          {layout === 'page' ? <span>{sending ? 'Sending' : 'Send'}</span> : null}
          <ArrowUp aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** Props for {@link ConnectDialog}. */
export interface ConnectDialogProps {
  /** The org the added connector belongs to. */
  readonly orgId: string;
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
}

/** The connect dialog opened from the composer's attach control. */
export function ConnectDialog({ orgId, open, onOpenChange }: ConnectDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Connect an app</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <AddMcpConnectorForm
            orgId={orgId}
            onConnected={() => {
              onOpenChange(false);
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
