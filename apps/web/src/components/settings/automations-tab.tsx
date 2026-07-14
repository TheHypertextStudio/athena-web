/**
 * The Automations settings surface — view, enable/disable, and delete automation rules.
 *
 * @remarks
 * Rules are data (`on → when → then`); shipped defaults arrive as editable `isSeed` rows.
 * This v1 lists rules with an enable/disable toggle and delete; authoring the predicate/action
 * graph is a later surface. See `docs/engineering/specs/automations.md`.
 */
'use client';

import type { ActionSpec, AutomationRuleOut } from '@docket/types';
import { Button, Card, CardContent } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useAutomationRules } from '@/lib/use-automation-rules';

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
}: {
  rule: AutomationRuleOut;
  canManage: boolean;
  onToggle: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{rule.name}</span>
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
  const { rules, isPending, setEnabled, remove, actionError } = useAutomationRules(orgId);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Rules run when something happens anywhere in Docket — a task completes, an issue arrives
        from a connected tool, an email suggestion appears — and take actions like setting a status,
        assigning, notifying, archiving the source email, or dismissing a suggestion. Defaults are
        seeded for you to edit.
      </p>

      {isPending ? (
        <p className="text-muted-foreground text-sm">Loading rules…</p>
      ) : rules.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No automation rules yet. Defaults appear once email-to-task is enabled for a connected
          mailbox.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              canManage={canManage}
              onToggle={() => void setEnabled(rule.id, !rule.enabled)}
              onDelete={() => void remove(rule.id)}
            />
          ))}
        </div>
      )}

      {actionError ? <p className="text-destructive text-xs">{actionError}</p> : null}
    </div>
  );
}
