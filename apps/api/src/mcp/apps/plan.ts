/**
 * `@docket/api` — the day-plan widget.
 *
 * @remarks
 * A day is the one thing on this surface that is genuinely ordered, and order is what prose is
 * worst at: "then the review, then the vendor call" reads fine and is unverifiable. The card shows
 * the sequence, so a person can see the shape of their day rather than reconstruct it.
 *
 * Ticking an item off is here because it is the one plan edit that happens *while looking at the
 * plan*. Adding, removing, and timeboxing are all things someone says; completing is something
 * they do, and making them dictate it back as a sentence would be the widget getting in the way.
 */
import { appDocument } from './runtime';

const BODY = `
<div class="head">
  <div class="headline" id="headline" aria-live="polite"></div>
  <button id="expand" class="quiet" hidden></button>
</div>
<div class="rows" id="rows"></div>
<div class="muted" id="next"></div>`;

const SCRIPT = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  const INLINE_ROWS = 4;
  let day = null;

  function time(iso) {
    // The host's timezone and locale, not the browser's. A plan built for someone in New York
    // must not read three hours early because the laptop showing it is in Los Angeles.
    return window.docket.time(iso, { hour: 'numeric', minute: '2-digit' });
  }

  function markDone(check, name) {
    check.textContent = '✓';
    check.setAttribute('aria-checked', 'true');
    check.disabled = true;
    name.classList.add('done');
  }

  function row(item) {
    const node = document.createElement('div');
    node.className = 'row';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title;
    name.title = item.title;

    const check = document.createElement('button');
    check.className = 'tick';
    // A glyph is not a name. Without this the control reads as "button" and nothing else, which
    // is useless when there are four of them stacked.
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-label', 'Mark “' + item.title + '” done');
    check.setAttribute('aria-checked', item.status === 'done' ? 'true' : 'false');
    check.textContent = item.status === 'done' ? '✓' : '○';
    check.disabled = item.status === 'done';
    check.addEventListener('click', async () => {
      check.disabled = true;
      try {
        await window.docket.call('plan_day', {
          orgId: window.docket.input.orgId,
          date: day.date,
          edits: [{ action: 'complete', taskId: item.taskId }],
        });
        markDone(check, name);
      } catch {
        check.disabled = false;
        window.docket.notice('That could not be ticked off. Open Docket to check it.', 'error');
      }
    });

    if (item.status === 'done') {
      name.classList.add('done');
    }

    node.append(check, name);
    if (item.startsAt) {
      const when = document.createElement('span');
      when.className = 'muted';
      when.textContent = time(item.startsAt);
      node.appendChild(when);
    }
    return node;
  }

  function hourOf(item) {
    if (!item.startsAt) {
      return 'Unscheduled';
    }
    return window.docket.time(item.startsAt, { hour: 'numeric' }) || 'Unscheduled';
  }

  function renderRows(rows, items) {
    const full = window.docket.displayMode === 'fullscreen';
    if (!full) {
      for (const item of items.slice(0, INLINE_ROWS)) {
        rows.appendChild(row(item));
      }
      if (items.length > INLINE_ROWS) {
        const more = document.createElement('div');
        more.className = 'muted';
        more.textContent = '…and ' + String(items.length - INLINE_ROWS) + ' more';
        rows.appendChild(more);
      }
      return;
    }
    // A day is the one thing on this surface that is genuinely ordered, so the expanded view keeps
    // the order and adds the shape: which hour each block belongs to.
    let currentHour = null;
    for (const item of items) {
      const hour = hourOf(item);
      if (hour !== currentHour) {
        currentHour = hour;
        const heading = document.createElement('div');
        heading.className = 'group-label';
        heading.textContent = hour;
        rows.appendChild(heading);
      }
      rows.appendChild(row(item));
    }
  }

  function render() {
    if (!day) {
      return;
    }
    const items = day.items || [];
    const full = window.docket.displayMode === 'fullscreen';

    const left = items.filter((i) => i.status !== 'done').length;
    el('headline').textContent =
      items.length === 0
        ? 'Nothing planned'
        : String(items.length) + ' planned, ' + String(left) + ' to go';

    const rows = el('rows');
    rows.replaceChildren();
    renderRows(rows, items);

    const expand = el('expand');
    expand.hidden =
      !window.docket.canDisplay('fullscreen') || (!full && items.length <= INLINE_ROWS);
    expand.textContent = full ? 'Show less' : 'Show all';

    // The next timebox is the single most useful fact about a day at a glance.
    const upcoming = items.find((i) => i.status !== 'done' && i.startsAt);
    el('next').textContent = upcoming ? 'Next timebox ' + time(upcoming.startsAt) : '';
  }

  el('expand').addEventListener('click', () => {
    void window.docket.requestDisplayMode(
      window.docket.displayMode === 'fullscreen' ? 'inline' : 'fullscreen',
    );
  });

  window.docket.onDisplayMode(render);

  window.docket.onData((data) => {
    day = data;
    render();
  });
})();
`;

/** The rendered plan document. */
export const PLAN_HTML = appDocument('Day plan', BODY, SCRIPT, {
  skeletonRows: 4,
  displayModes: ['inline', 'fullscreen'],
});
