/**
 * The Automations settings surface — rename, enable/disable, and delete automation rules.
 *
 * @remarks
 * Rules are data (`on → when → then`); shipped defaults arrive as editable `isSeed` rows.
 * This surface keeps user-facing rule identity and lifecycle controls editable while preserving
 * the server-authored trigger/condition/action summary. See `docs/engineering/specs/automations.md`.
 */
'use client';

import type { ActionSpec } from '@docket/automation/contracts';
import type { AutomationRuleCreate, AutomationRuleOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { Workflow } from '@docket/ui/icons';
import { Button, Card, CardContent, Input, Select } from '@docket/ui/primitives';
import NextLink from 'next/link';
import { type JSX, useEffect, useRef, useState } from 'react';

import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { EditableTitle } from '@/components/editor/editable-title';
import { LoadFailure } from './load-failure';
import { useAutomationRules } from '@/lib/use-automation-rules';

/** Transient persistence status for an in-place autosave field. */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** How long the quiet "Saved" acknowledgement lingers before fading back to idle. */
const SAVED_LINGER_MS = 2000;

/** Supported guided templates for creating a rule without exposing the rule grammar. */
export type AutomationTemplate =
  | 'archive_completed_email'
  | 'dismiss_promotions'
  | 'assign_new_tasks_to_cycle';

const TEMPLATE_NAMES: Record<AutomationTemplate, string> = {
  archive_completed_email: 'Archive source email when its task is completed',
  dismiss_promotions: 'Dismiss promotional email suggestions',
  assign_new_tasks_to_cycle: 'Assign new tasks to the current cycle',
};

/** Build a validated automation-rule payload from one guided user-facing template. */
export function automationTemplateInput(
  template: AutomationTemplate,
  name: string,
): AutomationRuleCreate {
  if (template === 'archive_completed_email') {
    return {
      name: name.trim(),
      enabled: true,
      on: { kind: 'completed', subjectType: 'task' },
      when: { op: 'and', nodes: [] },
      then: [{ type: 'mail.archive', params: {} }],
    };
  }
  if (template === 'assign_new_tasks_to_cycle') {
    return {
      name: name.trim(),
      enabled: true,
      on: { kind: 'created', subjectType: 'task' },
      when: { op: 'and', nodes: [] },
      then: [{ type: 'task.assignToCycle', params: {} }],
    };
  }
  return {
    name: name.trim(),
    enabled: true,
    on: { kind: 'created', subjectType: 'email_suggestion' },
    when: { op: 'eq', path: 'detail.category', value: 'promotions' },
    then: [{ type: 'suggestion.dismiss', params: {} }],
  };
}

/**
 * Plain-language phrases for the action commands a rule can run.
 *
 * @remarks
 * `ActionSpec.type` is an open string on the wire — the executor grows new commands without a
 * schema change — so this maps the ones that exist and {@link humanizeToken} carries anything
 * newer. Before this, the row printed the identifier itself: a rule read `on created →
 * mail.archive, suggestion.dismiss`, which is the product's own internals quoted at the person
 * using it.
 */
const ACTION_PHRASE: Readonly<Record<string, string>> = {
  'mail.applyLabel': 'label the email',
  'mail.archive': 'archive the email',
  'mail.markRead': 'mark the email read',
  'mail.markUnread': 'mark the email unread',
  'mail.removeLabel': 'remove the email label',
  'mail.trash': 'move the email to trash',
  'suggestion.autoAccept': 'accept the suggestion',
  'suggestion.dismiss': 'dismiss the suggestion',
  'task.applyLabel': 'label the task',
  'task.assign': 'assign the task',
  'task.assignToCycle': 'add the task to the current cycle',
  'task.route': 'move the task',
  'task.setPriority': 'set the priority',
  'task.setStatus': 'set the status',
};

/** Plain-language phrases for what starts a rule. */
const TRIGGER_PHRASE: Readonly<Record<string, string>> = {
  email_suggestion: 'a suggestion arrives from email',
  task: 'a task changes',
  created: 'something new arrives',
  updated: 'something changes',
  completed: 'something is completed',
};

/** Turn an unmapped `dotted.camelCase` identifier into readable words. */
function humanizeToken(token: string): string {
  const tail = token.includes('.') ? (token.split('.').pop() ?? token) : token;
  return tail
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

/** A short human summary of what a rule does, from its `on`/`then`. */
function ruleSummary(rule: AutomationRuleOut): string {
  const triggerKey = rule.on.subjectType ?? rule.on.kind;
  const trigger =
    (triggerKey === undefined ? undefined : TRIGGER_PHRASE[triggerKey]) ??
    (triggerKey === undefined ? 'anything happens' : humanizeToken(triggerKey));
  const actions = rule.then.map((a: ActionSpec) => ACTION_PHRASE[a.type] ?? humanizeToken(a.type));
  if (actions.length === 0) return `When ${trigger}, do nothing yet.`;
  return `When ${trigger}, ${actions.join(' and ')}.`;
}

/** One rule row: name (autosaves in place) + summary + enable/disable + delete. */
function RuleRow({
  rule,
  canManage,
  onToggle,
  onDelete,
  onRename,
}: {
  rule: AutomationRuleOut;
  canManage: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (name: string) => Promise<void>;
}): JSX.Element {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Never leave a pending "Saved → idle" timer behind on unmount.
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  // Autosave the rename the moment the field is committed (blur / Enter). `EditableTitle` only
  // fires this with a non-empty value that actually differs from the persisted name, so the dirty
  // guard is intrinsic — mounting or re-committing the unchanged name never triggers a save.
  async function saveName(next: string): Promise<void> {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setStatus('saving');
    try {
      await onRename(next);
      setStatus('saved');
      savedTimer.current = setTimeout(() => {
        setStatus('idle');
      }, SAVED_LINGER_MS);
    } catch {
      // The rule is unchanged server-side; surface a quiet inline error and let the user retry.
      setStatus('error');
    }
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <EditableTitle
              value={rule.name}
              onSave={(next) => void saveName(next)}
              canEdit={canManage}
              ariaLabel={`Automation name for ${rule.name}`}
              className="text-label-large truncate"
            />
            {rule.isSeed ? (
              <span className="text-on-surface-variant bg-surface-container-high text-label-small rounded px-1">
                default
              </span>
            ) : null}
            {!rule.enabled ? (
              <span className="text-on-surface-variant text-label-small">off</span>
            ) : null}
            {status === 'saved' ? (
              <span className="text-on-surface-variant text-body-small">Saved</span>
            ) : status === 'error' ? (
              <span className="text-error text-body-small" role="alert">
                Couldn’t save
              </span>
            ) : null}
          </div>
          <span className="text-on-surface-variant text-body-small truncate">
            {ruleSummary(rule)}
          </span>
        </div>
        {canManage ? (
          <div className="flex shrink-0 gap-1.5">
            <Button variant="outline" size="sm" onClick={onToggle}>
              {rule.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-error focus:text-error"
              onClick={onDelete}
              aria-label={`Delete ${rule.name}`}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The automations settings tab.
 *
 * @param orgId - The active organization id.
 * @param canManage - Whether the viewer may edit rules (`manage`).
 */
export default function AutomationsTab({
  orgId,
  canManage,
}: {
  orgId: string;
  canManage: boolean;
}): JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState<AutomationRuleOut | null>(null);
  // The empty state names Connections; a name is not a way of getting there.
  const connectionsHref = `/orgs/${orgId}/settings/connections`;
  const { rules, isPending, loadError, createRule, rename, setEnabled, remove, actionError } =
    useAutomationRules(orgId);
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState<AutomationTemplate>('archive_completed_email');
  const [name, setName] = useState(TEMPLATE_NAMES.archive_completed_email);
  const [saving, setSaving] = useState(false);

  async function submitRule(): Promise<void> {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createRule(automationTemplateInput(template, name));
      setCreating(false);
      setTemplate('archive_completed_email');
      setName(TEMPLATE_NAMES.archive_completed_email);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-on-surface-variant text-body-medium">
          Rules watch for something happening in Docket and take an action in response.
        </p>
        {canManage ? (
          <Button
            className="shrink-0"
            onClick={() => {
              setCreating((current) => !current);
            }}
          >
            {creating ? 'Close' : 'New automation'}
          </Button>
        ) : null}
      </div>

      {creating ? (
        <Card>
          <CardContent className="grid gap-4 p-4">
            <div>
              <h3 className="text-on-surface text-title-small">New automation</h3>
              <p className="text-on-surface-variant text-body-small">
                Pick a workflow to start from. You can change it later.
              </p>
            </div>
            <label className="text-on-surface text-label-large flex flex-col gap-1.5">
              Workflow
              <Select
                value={template}
                onChange={(event) => {
                  const next = event.target.value as AutomationTemplate;
                  setTemplate(next);
                  setName(TEMPLATE_NAMES[next]);
                }}
              >
                <option value="archive_completed_email">Archive email after task completion</option>
                <option value="dismiss_promotions">Dismiss promotional suggestions</option>
                <option value="assign_new_tasks_to_cycle">Assign new tasks to current cycle</option>
              </Select>
            </label>
            <label className="text-on-surface text-label-large flex flex-col gap-1.5">
              Name
              <Input
                value={name}
                maxLength={160}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <Button
              className="w-fit"
              disabled={saving || !name.trim()}
              onClick={() => void submitRule()}
            >
              {saving ? 'Creating…' : 'Create automation'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isPending ? (
        <p className="text-on-surface-variant text-body-medium">Loading rules…</p>
      ) : loadError ? (
        <LoadFailure message={loadError} retrying />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automation rules yet"
          body="Rules act on your tasks and email suggestions without you having to."
          className="border-none bg-transparent"
          action={
            <Button asChild variant="ghost" size="sm">
              <NextLink href={connectionsHref}>Connect a mailbox</NextLink>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              canManage={canManage}
              onRename={(name) => rename(rule.id, name)}
              onToggle={() => void setEnabled(rule.id, !rule.enabled)}
              onDelete={() => {
                setConfirmDelete(rule);
              }}
            />
          ))}
        </div>
      )}

      <ConfirmDestructiveDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title="Delete this rule?"
        description={`“${confirmDelete?.name ?? ''}” stops running and cannot be recovered. Work it already acted on is unchanged.`}
        confirmLabel="Delete rule"
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />

      {actionError ? (
        <p className="text-error text-body-small" role="alert">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
