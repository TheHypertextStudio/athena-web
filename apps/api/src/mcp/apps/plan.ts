/**
 * `@docket/api` — the day-plan widget.
 *
 * @remarks
 * A day is the one thing on this surface that is genuinely ordered, and order is what prose is
 * worst at: "then the review, then the vendor call" reads fine and is unverifiable. The card shows
 * the sequence — each timebox a row anchored by its tick, its start time aligned on the right — so a
 * person sees the shape of the day rather than reconstructing it. Fullscreen groups the day by hour.
 *
 * Ticking an item off is here because it is the one plan edit that happens *while looking at the
 * plan*. Adding, removing, and timeboxing are things someone says; completing is something they do.
 */
import { appDocument } from './runtime';

const SCRIPT = String.raw`
(() => {
  const d = window.docket;
  const INLINE_ROWS = 5;
  let day = null;

  const time = (iso) => d.time(iso, { hour: 'numeric', minute: '2-digit' });

  function tick(item) {
    const done = item.status === 'done';
    const button = d.el('button', 'tick');
    button.type = 'button';
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', done ? 'true' : 'false');
    button.setAttribute('aria-label', 'Mark “' + item.title + '” done');
    const glyph = d.checkGlyph(done);
    if (glyph) button.appendChild(glyph);
    button.disabled = done;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await d.call('plan_day', { orgId: d.input.orgId, date: day.date, edits: [{ action: 'complete', taskId: item.taskId }] });
        item.status = 'done';
        d.notice('');
        draw();
      } catch {
        button.disabled = false;
        d.notice('That could not be ticked off. Open Docket to check it.', 'error');
      }
    });
    return button;
  }

  function row(item) {
    return { anchor: tick(item), title: item.title, done: item.status === 'done', trailing: item.startsAt ? time(item.startsAt) : '' };
  }

  function hourOf(item) {
    return (item.startsAt && d.time(item.startsAt, { hour: 'numeric' })) || 'Unscheduled';
  }

  function hours(items) {
    const groups = [];
    for (const item of items) {
      const hour = hourOf(item);
      const last = groups[groups.length - 1];
      if (last && last.hour === hour) last.items.push(item);
      else groups.push({ hour, items: [item] });
    }
    return groups;
  }

  function draw() {
    if (!day) return;
    const items = day.items || [];
    const left = items.filter((item) => item.status !== 'done').length;
    const next = items.find((item) => item.status !== 'done' && item.startsAt);
    const shown = d.fullscreen ? items : items.slice(0, INLINE_ROWS);
    const view = d.canvas();
    view.appendChild(d.header({
      kind: 'due', kicker: 'Day plan',
      title: day.date ? d.label(day.date) : 'Today',
      chips: items.length === 0 ? [] : [String(items.length) + ' planned', String(left) + ' to go', next && 'Next ' + time(next.startsAt)],
    }));
    if (items.length === 0) return;
    if (d.fullscreen) {
      for (const group of hours(items)) {
        const section = d.section({ label: group.hour, count: group.items.length });
        for (const item of group.items) section.body.appendChild(d.row(row(item)));
        view.appendChild(section.node);
      }
      return;
    }
    const more = items.length > shown.length ? d.overflowAction('Show all') : null;
    const section = d.section({ label: 'Timeboxes', count: shown.length < items.length ? shown.length + ' of ' + items.length : items.length, action: more });
    for (const item of shown) section.body.appendChild(d.row(row(item)));
    view.appendChild(section.node);
  }

  d.onDisplayMode(draw);
  d.onData((data) => {
    day = data;
    draw();
  });
})();
`;

/** The rendered plan document. */
export const PLAN_HTML = appDocument('Day plan', SCRIPT, { skeletonRows: 4 });
