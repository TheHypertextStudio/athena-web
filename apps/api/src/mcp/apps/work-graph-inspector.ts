/** Selection details keep relationship navigation and conversation actions beside the map. */
export const GRAPH_INSPECTOR_SCRIPT = String.raw`
window.docketGraphInspector = function (state, act) {
  const d = window.docket,
    node = state.snapshot.nodes.find((n) => n.key === state.selected);
  if (!node) return null;
  const panel = d.el('aside', 'graph-inspector');
  panel.setAttribute('aria-label', 'Selected work');
  const heading = d.el('div', 'graph-detail-heading');
  heading.appendChild(
    d.el('span', 'graph-meta', node.kind + (node.external ? ' · Outside scope' : '')),
  );
  heading.appendChild(d.button('×', () => act.select(null), { label: 'Close selected work' }));
  panel.appendChild(heading);
  panel.appendChild(d.el('h2', '', node.title));
  const status = d.el('div', 'graph-detail-status');
  const glyph = d.stateGlyph(node.category);
  if (glyph) status.appendChild(glyph);
  status.appendChild(d.el('span', 'graph-meta', node.status));
  panel.appendChild(status);
  const primary = d.el('div', 'graph-actions');
  primary.appendChild(d.button('Ask about this', () => act.ask(node), { tonal: true }));
  primary.appendChild(d.button('Open in Docket', () => d.link(node.href)));
  panel.appendChild(primary);
  const byKey = new Map(state.snapshot.nodes.map((n) => [n.key, n]));
  const boundary = state.snapshot.boundaries.find((b) => b.key === node.key);
  function section(incoming) {
    const section = d.el('section', 'graph-detail-section');
    const head = d.el('div', 'graph-detail-heading');
    head.appendChild(d.el('h3', '', incoming ? 'Prerequisites' : 'Downstream work'));
    const items = state.snapshot.edges
      .filter((e) => (incoming ? e.target : e.source) === node.key)
      .map((e) => ({
        work: byKey.get(incoming ? e.source : e.target),
        outside: false,
        aggregated: e.aggregated,
      }));
    for (const c of boundary?.connections || [])
      if (c.direction === (incoming ? 'incoming' : 'outgoing'))
        items.push({ work: c.work, outside: true });
    if (items.length)
      head.appendChild(
        d.button('Trace', () => act.trace(incoming ? 'before' : 'after'), {
          label: incoming ? 'Trace prerequisites' : 'Show what this unlocks',
        }),
      );
    section.appendChild(head);
    for (const item of items) {
      if (!item.work) continue;
      const row = d.button('', () =>
        item.outside ? act.reveal(item.work) : act.select(item.work.key),
      );
      row.classList.add('graph-detail-link');
      row.appendChild(d.el('span', '', item.work.title));
      row.appendChild(
        d.el(
          'span',
          'graph-meta',
          item.work.status +
            (item.outside ? ' · Reveal' : item.aggregated ? ' · Grouped dependencies' : ''),
        ),
      );
      section.appendChild(row);
    }
    const total = boundary?.[incoming ? 'incoming' : 'outgoing'] || 0,
      named = items.filter((i) => i.outside).length;
    if (total > named)
      section.appendChild(
        d.button(total - named + ' more connections · Open neighborhood', () =>
          act.scope({ kind: node.kind, id: node.id }),
        ),
      );
    if (!items.length && !total)
      section.appendChild(d.el('p', 'graph-meta', 'None recorded in this view'));
    return section;
  }
  panel.append(section(true), section(false));
  if (state.trace.size) panel.appendChild(d.button('Clear trace', () => act.trace('clear')));
  const navigation = d.el('div', 'graph-actions');
  if (node.childCount)
    navigation.appendChild(
      d.button(
        (state.args.expanded || []).includes(node.key) ? 'Collapse group' : 'Expand group',
        () => act.expand(node.key),
      ),
    );
  navigation.appendChild(
    d.button('Open neighborhood', () => act.scope({ kind: node.kind, id: node.id })),
  );
  panel.appendChild(navigation);
  return panel;
};
`;
