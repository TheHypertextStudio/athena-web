/**
 * `@docket/api` — the entity widget.
 *
 * @remarks
 * One piece of work, shown where it was mentioned. The value over prose is not density — it is
 * that state and assignee are *current*: a transcript records what was true when the sentence was
 * written, and this reads the row.
 *
 * It shows where the item came from when a tool made it. "Created by Claude, from a conversation"
 * is the question people ask first about work that appeared without them typing it, and the change
 * set already knows the answer — authorship is recorded on its own axis rather than smuggled into
 * `provenance`, which means whether the row is mirrored from an external system.
 *
 * At most two actions, per the inline constraints: anything else is a sentence, not a button.
 */
import { appDocument } from './runtime';

const BODY = `
<div class="headline" id="title" aria-live="polite"></div>
<div class="rows"><div class="row" id="facts"></div></div>
<div class="muted" id="origin"></div>
<div class="actions">
  <button id="done" hidden>Mark done</button>
  <button id="open" hidden>Open in Docket</button>
</div>`;

const SCRIPT = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  let entity = null;

  function fact(label, value) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = label + ': ' + value;
    return span;
  }

  function describeOrigin(origin) {
    if (!origin) {
      return '';
    }
    // The client name when an agent made it, the tool otherwise — "created by capture" means
    // nothing to a person, but "created by Claude" does.
    const who = origin.client || 'an agent';
    const when = origin.at ? new Date(origin.at).toLocaleDateString() : '';
    return 'Created by ' + who + (when ? ' on ' + when : '');
  }

  window.docket.onData((data) => {
    const items = data.items || [];
    entity = items[0] || null;
    if (!entity) {
      el('title').textContent = 'Not found';
      el('facts').replaceChildren();
      el('origin').textContent = 'Nothing here matches that any more.';
      return;
    }

    el('title').textContent = entity.title || entity.name || entity.id;

    const facts = el('facts');
    facts.replaceChildren();
    const state = entity.state || entity.status;
    if (state) {
      // The glyph carries the canonical type and the text carries the team's own name for it.
      // Both, because "Doing" alone does not say whether the work has started.
      const glyph = window.docket.stateGlyph(entity.stateType);
      if (glyph) {
        facts.appendChild(glyph);
      }
      facts.appendChild(fact('State', String(state).replace(/_/g, ' ')));
    }
    if (entity.priority && entity.priority !== 'none') {
      facts.appendChild(fact('Priority', entity.priority));
    }
    if (entity.dueDate) {
      facts.appendChild(fact('Due', String(entity.dueDate).slice(0, 10)));
    }
    if (Array.isArray(entity.blockedBy) && entity.blockedBy.length > 0) {
      facts.appendChild(fact('Blocked by', String(entity.blockedBy.length)));
    }

    el('origin').textContent = describeOrigin(entity.origin);
    el('done').hidden = !entity.state || entity.state === 'done';
    el('open').hidden = false;
  });

  el('done').addEventListener('click', async () => {
    if (!entity) {
      return;
    }
    const button = el('done');
    button.disabled = true;
    try {
      await window.docket.call('update', {
        orgId: window.docket.input.orgId,
        entity: 'task',
        scope: { ids: [entity.id] },
        set: { state: 'done' },
      });
      button.hidden = true;
      el('facts').replaceChildren(fact('State', 'done'));
      await window.docket.tell('The user marked "' + (entity.title || entity.id) + '" done from the card.');
    } catch {
      button.disabled = false;
      window.docket.notice('That could not be marked done. Open Docket to check it.', 'error');
    }
  });

  el('open').addEventListener('click', () => {
    const orgId = window.docket.input.orgId;
    if (entity && orgId) {
      window.docket.link('/orgs/' + orgId + '/tasks/' + entity.id);
    }
  });
})();
`;

/** The rendered entity document. */
export const ENTITY_HTML = appDocument('Entity', BODY, SCRIPT, 1);
