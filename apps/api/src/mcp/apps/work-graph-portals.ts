/** Named offscreen connections stay outside the canvas so they never cover selectable work. */
export const GRAPH_PORTALS_SCRIPT = String.raw`
window.docketGraphPortals = function (stage, state, act, height) {
  const layer = stage.closest('.graph-shell').querySelector('.graph-offscreen');
  if (!layer) return;
  layer.replaceChildren();
  if (!state.camera || !state.selected) return;
  const d = window.docket,
    c = state.camera,
    byKey = new Map(state.snapshot.nodes.map((n) => [n.key, n])),
    seen = new Set();
  for (const edge of state.snapshot.edges) {
    const incoming = edge.target === state.selected;
    const other =
      edge.source === state.selected
        ? byKey.get(edge.target)
        : incoming
          ? byKey.get(edge.source)
          : null;
    if (!other || seen.has(other.key)) continue;
    seen.add(other.key);
    const x = c.x + other.x * c.scale,
      y = c.y + other.y * c.scale,
      w = Math.min(other.width, 238) * c.scale,
      h = Math.min(other.height, 96) * c.scale;
    if (x >= 0 && x + w <= stage.clientWidth && y >= 0 && y + h <= height) continue;
    if (layer.childNodes.length >= 4) break;
    const label = d.button(
      '',
      () => {
        act.select(other.key);
        act.frame(other.key);
      },
      { label: 'Show ' + other.title },
    );
    label.classList.add('graph-portal');
    label.title = (incoming ? 'Prerequisite' : 'Downstream work') + ' outside view: ' + other.title;
    const icon = other.kind === 'task' ? d.stateGlyph(other.category) : d.kindIcon(other.kind);
    if (icon) label.appendChild(icon);
    label.appendChild(d.el('span', '', other.title));
    const arrow = d.kindIcon('child');
    if (arrow) {
      if (incoming) arrow.classList.add('graph-icon-incoming');
      label.appendChild(arrow);
    }
    layer.appendChild(label);
  }
};
`;
