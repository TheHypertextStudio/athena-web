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
import { Badge, Button, Field, Input, Select, Skeleton } from '@docket/ui/primitives';
import NextLink from '@/components/docket-link';
import { type JSX, useEffect, useRef, useState } from 'react';

import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { EditableTitle } from '@/components/editor/editable-title';
import { LoadFailure } from './load-failure';
import { SettingRow } from './setting-row';
import { SettingRowStatus } from './setting-row-status';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';
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
    <SettingRow
      label={
        <span className="flex min-w-0 items-center gap-2">
          <EditableTitle
            value={rule.name}
            onSave={(next) => void saveName(next)}
            canEdit={canManage}
            ariaLabel={`Automation name for ${rule.name}`}
            className="text-label-large truncate"
          />
          {/* Badges rather than hand-tinted spans: the tonal container roles are what make a
              seeded rule and a switched-off one read as different states at a glance, and the
              spans here were painting two of them the same muted grey. */}
          {rule.isSeed ? <Badge variant="secondary">Default</Badge> : null}
          {rule.enabled ? null : <Badge variant="outline">Off</Badge>}
        </span>
      }
      description={ruleSummary(rule)}
      trailing={
        <span className="flex shrink-0 items-center gap-1.5">
          <SettingRowStatus pending={false} saved={status === 'saved'} />
          {status === 'error' ? (
            <span className="text-error text-body-small" role="alert">
              Couldn’t save
            </span>
          ) : null}
          {canManage ? (
            <>
              <Button variant="outline" size="sm" onClick={onToggle}>
                {rule.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="ghost-destructive"
                size="sm"
                onClick={onDelete}
                aria-label={`Delete ${rule.name}`}
              >
                Delete
              </Button>
            </>
          ) : null}
        </span>
      }
    />
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
    <SettingsGroup
      capability={SETTINGS_NODES.workspaceAutomationsRules}
      body="rows"
      action={
        canManage && (rules.length > 0 || creating) ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating((current) => !current);
            }}
          >
            {creating ? 'Close' : 'New automation'}
          </Button>
        ) : undefined
      }
    >
      {creating ? (
        // The create form is a step inside this group, not a card of its own: nesting a card of
        // the same tone inside one paints it its parent's colour and separates nothing.
        <div className="border-outline-variant grid gap-4 border-b px-4 py-4">
          <div>
            <p className="text-on-surface text-label-large">New automation</p>
            <p className="text-on-surface-variant text-body-small">
              Pick a workflow to start from. You can change it later.
            </p>
          </div>
          <Field label="Workflow">
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
          </Field>
          <Field label="Name">
            <Input
              value={name}
              maxLength={160}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <Button
            className="w-fit"
            disabled={saving || !name.trim()}
            onClick={() => void submitRule()}
          >
            {saving ? 'Creating…' : 'Create automation'}
          </Button>
        </div>
      ) : null}

      {isPending ? (
        <Skeleton className="m-4 h-20 rounded-xl" />
      ) : loadError ? (
        <LoadFailure message={loadError} retrying />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automation rules yet"
          body="A rule watches for something — a suggestion arriving, a task falling due — and does the next step for you."
          frame="none"
          {...(canManage
            ? {
                cta: {
                  label: 'New automation',
                  onClick: () => {
                    setCreating(true);
                  },
                },
              }
            : {})}
          action={
            <Button asChild variant="ghost" size="sm">
              <NextLink href={connectionsHref}>Connect a mailbox for email rules</NextLink>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col">
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
        <p className="text-error text-body-small px-4 pb-3" role="alert">
          {actionError}
        </p>
      ) : null}
    </SettingsGroup>
  );
}
