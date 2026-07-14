/**
 * The Automations settings surface — rename, enable/disable, and delete automation rules.
 *
 * @remarks
 * Rules are data (`on → when → then`); shipped defaults arrive as editable `isSeed` rows.
 * This surface keeps user-facing rule identity and lifecycle controls editable while preserving
 * the server-authored trigger/condition/action summary. See `docs/engineering/specs/automations.md`.
 */
'use client';

import type { ActionSpec, AutomationRuleCreate, AutomationRuleOut } from '@docket/types';
import { Button, Card, CardContent, Input } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { useAutomationRules } from '@/lib/use-automation-rules';

/** Supported guided templates for creating a rule without exposing the rule grammar. */
export type AutomationTemplate = 'archive_completed_email' | 'dismiss_promotions';

const TEMPLATE_NAMES: Record<AutomationTemplate, string> = {
  archive_completed_email: 'Archive source email when its task is completed',
  dismiss_promotions: 'Dismiss promotional email suggestions',
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
  return {
    name: name.trim(),
    enabled: true,
    on: { kind: 'created', subjectType: 'email_suggestion' },
    when: { op: 'eq', path: 'detail.category', value: 'promotions' },
    then: [{ type: 'suggestion.dismiss', params: {} }],
  };
}

/** A short human summary of what a rule does, from its `on`/`then`. */
function ruleSummary(rule: AutomationRuleOut): string {
  const on = rule.on.kind ?? rule.on.subjectType ?? 'any event';
  const actions = rule.then.map((a: ActionSpec) => a.type).join(', ') || 'no actions';
  return `on ${on} → ${actions}`;
}

/** One rule row: name + summary + enable/disable + delete. */
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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(rule.name);
  const [savingName, setSavingName] = useState(false);

  async function saveName(): Promise<void> {
    const next = name.trim();
    if (!next || next === rule.name) {
      setName(rule.name);
      setEditing(false);
      return;
    }
    setSavingName(true);
    try {
      await onRename(next);
      setEditing(false);
    } finally {
      setSavingName(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            {editing ? (
              <Input
                value={name}
                aria-label={`Automation name for ${rule.name}`}
                autoFocus
                maxLength={160}
                className="h-8 max-w-sm"
                onChange={(event) => {
                  setName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveName();
                  if (event.key === 'Escape') {
                    setName(rule.name);
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <span className="truncate text-sm font-medium">{rule.name}</span>
            )}
            {rule.isSeed ? (
              <span className="text-muted-foreground bg-muted rounded px-1 text-[10px]">
                default
              </span>
            ) : null}
            {!rule.enabled ? <span className="text-muted-foreground text-[10px]">off</span> : null}
          </div>
          <span className="text-muted-foreground truncate text-xs">{ruleSummary(rule)}</span>
        </div>
        {canManage ? (
          <div className="flex shrink-0 gap-1.5">
            {editing ? (
              <>
                <Button
                  size="sm"
                  disabled={savingName || !name.trim()}
                  onClick={() => void saveName()}
                >
                  {savingName ? 'Saving…' : 'Save name'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setName(rule.name);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(true);
                }}
              >
                Rename
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onToggle}>
              {rule.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Delete rule">
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
  const { rules, isPending, createRule, rename, setEnabled, remove, actionError } =
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
        <p className="text-muted-foreground text-sm">
          Rules run when something happens anywhere in Docket — a task completes, an issue arrives
          from a connected tool, an email suggestion appears — and take actions like setting a
          status, assigning, notifying, archiving the source email, or dismissing a suggestion.
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
              <h3 className="text-on-surface text-sm font-semibold">New automation</h3>
              <p className="text-on-surface-variant text-xs">
                Start with a proven workflow; you can rename, pause, or remove it at any time.
              </p>
            </div>
            <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
              Workflow
              <select
                value={template}
                onChange={(event) => {
                  const next = event.target.value as AutomationTemplate;
                  setTemplate(next);
                  setName(TEMPLATE_NAMES[next]);
                }}
                className="border-outline-variant bg-surface text-on-surface focus-visible:ring-ring h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
              >
                <option value="archive_completed_email">Archive email after task completion</option>
                <option value="dismiss_promotions">Dismiss promotional suggestions</option>
              </select>
            </label>
            <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
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
        <p className="text-muted-foreground text-sm">Loading rules…</p>
      ) : rules.length === 0 ? (
        <div className="border-outline-variant bg-surface-container-low flex flex-col gap-1 rounded-lg border p-4">
          <p className="text-on-surface text-sm font-medium">No automation rules yet.</p>
          <p className="text-muted-foreground text-sm">
            Create a rule for a recurring workflow, or connect a mailbox from Connections to bring
            email suggestions into Docket.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              canManage={canManage}
              onRename={(name) => rename(rule.id, name)}
              onToggle={() => void setEnabled(rule.id, !rule.enabled)}
              onDelete={() => void remove(rule.id)}
            />
          ))}
        </div>
      )}

      {actionError ? (
        <p className="text-destructive text-xs" role="alert">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
