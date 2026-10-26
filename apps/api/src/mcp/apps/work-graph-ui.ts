/** Canonical icons and compact location context shared across graph controls and inspectors. */
export const GRAPH_UI_SCRIPT = String.raw`
window.docketGraphUi = {
  button(text, icon, action, options) {
    const d = window.docket,
      node = d.button(text, action, options),
      glyph = d.kindIcon(icon);
    if (glyph) node.prepend(glyph);
    return node;
  },
  location(state, key) {
    const d = window.docket,
      detail = state.snapshot.details?.find((n) => n.key === key);
    const path = [state.snapshot.scope, ...(detail?.trail || [])];
    const nav = d.el('nav', 'graph-location');
    nav.setAttribute('aria-label', 'Work location');
    path.forEach((item, index) => {
      if (index === 1 && detail?.trailTruncated) {
        const omitted = d.el('span', '', '…');
        omitted.title = 'Earlier groups omitted';
        nav.appendChild(omitted);
      }
      if (index) nav.appendChild(d.el('span', 'graph-location-separator', '/'));
      const kind = item.kind || item.key.split(':')[0],
        icon = kind === 'task' ? null : d.kindIcon(kind);
      const crumb = d.el('span', '');
      crumb.appendChild(d.el('span', 'graph-location-name', item.title));
      // Location text remains available when the corresponding group header is outside the viewport.
      crumb.title = item.title;
      if (icon) crumb.prepend(icon);
      nav.appendChild(crumb);
    });
    return nav;
  },
};
`;
