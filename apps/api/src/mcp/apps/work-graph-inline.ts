/** Dense conversation slice: readable work rows and only saved dependency relationships. */
export const GRAPH_INLINE_SCRIPT = String.raw`
window.docketGraphInline = function (state, act) {
  const d = window.docket,
    snapshot = state.snapshot,
    strip = d.el('div', 'graph-inline');
  // Stable topological ordering keeps prerequisite direction truthful without promising a schedule.
  const remaining = [...snapshot.nodes],
    ordered = [];
  while (remaining.length) {
    const i = remaining.findIndex(
      (n) =>
        !snapshot.edges.some(
          (e) => e.target === n.key && remaining.some((other) => other.key === e.source),
        ),
    );
    ordered.push(...remaining.splice(i < 0 ? 0 : i, 1));
  }
  for (const n of ordered) {
    const block = d.el('div', 'graph-inline-item');
    const before = snapshot.edges.filter(
      (e) =>
        e.target === n.key && ordered.slice(0, ordered.indexOf(n)).some((p) => p.key === e.source),
    );
    if (before.length) {
      const adjacent =
        before.length === 1 && ordered[ordered.indexOf(n) - 1]?.key === before[0].source;
      const label = adjacent
        ? '↓ Blocks'
        : '↓ Blocked by ' +
          before.map((e) => snapshot.nodes.find((p) => p.key === e.source)?.title).join(', ');
      const link = d.el('span', 'graph-inline-link', label);
      link.title = label;
      block.appendChild(link);
    }
    const row = d.button('', () => act.select(n.key));
    row.className = 'graph-inline-row';
    row.title = n.title;
    row.dataset.graphSelect = n.key;
    row.setAttribute('aria-pressed', String(state.selected === n.key));
    const glyph = n.kind === 'task' ? d.stateGlyph(n.category) : d.kindIcon(n.kind);
    if (glyph) row.appendChild(glyph);
    const text = d.el('span', 'graph-inline-text');
    text.appendChild(d.el('strong', '', n.title));
    text.appendChild(d.el('span', 'graph-meta', n.status + (n.external ? ' · Outside scope' : '')));
    row.append(text, d.el('span', 'graph-inline-open', '›'));
    block.appendChild(row);
    const branch = snapshot.completedBranches?.find((b) => b.target === n.key);
    if (branch) {
      const done = d.button(
        branch.count + ' completed ' + (branch.count === 1 ? 'prerequisite' : 'prerequisites'),
        () => act.reveal({ key: branch.focus, category: 'completed' }),
      );
      done.classList.add('graph-inline-completed');
      block.appendChild(done);
    }
    strip.appendChild(block);
  }
  return strip;
};
`;
