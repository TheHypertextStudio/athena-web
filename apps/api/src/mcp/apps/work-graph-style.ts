/** Embedded graph styling uses the same host tokens and controls as existing MCP cards. */
export const GRAPH_CSS = String.raw`
body[data-work-graph='active'] { background:var(--color-background-primary); }
.graph-shell { display:grid; gap:12px; min-width:0; }
.graph-shell p { margin:0; }
.graph-toolbar,.graph-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.graph-toolbar button,.graph-actions button { min-height:32px; }
.graph-meta { color:var(--color-text-secondary); font-size:var(--font-text-sm-size); }
.graph-summary { display:flex; flex-wrap:wrap; gap:14px; font-size:var(--font-text-sm-size); }
.graph-summary strong { color:var(--color-text-primary); font-weight:var(--font-weight-semibold); }
.graph-stage { position:relative; overflow:hidden; min-width:0; height:360px; border-radius:var(--border-radius-lg); background:var(--color-background-secondary); touch-action:pan-y; }
.graph-shell[data-exploring='true'] .graph-stage { height:520px; touch-action:none; }
.graph-world { position:absolute; inset:0 auto auto 0; transform-origin:0 0; }
.graph-edges { z-index:1; position:absolute; inset:0; overflow:visible; pointer-events:none; }
.graph-edges path { fill:none; stroke:var(--color-text-secondary); stroke-width:1.5; }
.graph-edges path[data-traced='true'] { stroke:var(--color-text-info); stroke-width:3; }
.graph-edges path.contribution { stroke-dasharray:4 5; opacity:.6; }
.graph-edge-label { font-size:11px; fill:var(--color-text-secondary); paint-order:stroke; stroke:var(--color-background-secondary); stroke-width:4px; stroke-linejoin:round; }
.graph-node { z-index:2; position:absolute; display:flex; flex-direction:column; align-items:stretch; justify-content:flex-start; gap:6px; border:1px solid transparent; border-radius:var(--border-radius-lg); background:var(--color-background-primary); padding:12px; color:var(--color-text-primary); font:inherit; text-align:left; overflow:hidden; }
.graph-node[data-container='true'] { z-index:0; background:var(--color-background-tertiary); border-color:var(--color-text-tertiary); border-style:dashed; }
.graph-node[aria-pressed='true'] { border:2px solid var(--color-text-info); padding:11px; }
.graph-node:focus-visible { outline:3px solid var(--color-ring-primary); outline-offset:3px; }
.graph-node[data-muted='true'] { opacity:.55; }
.graph-node[data-traced='true'] { box-shadow:0 0 0 2px var(--color-text-info); }
.graph-node-name { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; font-weight:var(--font-weight-medium); line-height:1.35; }
.graph-node-meta { display:flex; gap:6px; align-items:center; color:var(--color-text-secondary); font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.graph-node-kind { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--color-text-secondary); }
.graph-body { display:grid; gap:12px; min-width:0; }
.graph-inspector { display:grid; align-content:start; gap:12px; min-width:0; padding:14px; border-radius:var(--border-radius-lg); background:var(--color-background-secondary); }
.graph-inspector h2 { font-size:var(--font-text-md-size); margin:0; overflow-wrap:anywhere; }
.graph-inspector ul { margin:0; padding-left:18px; }
.graph-inspector li { margin:4px 0; overflow-wrap:anywhere; }
.graph-search { max-width:260px; min-width:0; flex:1 1 160px; }
.graph-search input { width:100%; min-width:0; }
.graph-relations { display:grid; gap:6px; }
.graph-relation { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:8px 0; }
.graph-relation button { max-width:100%; white-space:normal; text-align:left; overflow-wrap:anywhere; }
.graph-empty { display:grid; gap:8px; padding:32px 8px; }
.graph-legend { display:flex; gap:16px; flex-wrap:wrap; color:var(--color-text-secondary); font-size:12px; }
.graph-done { display:flex; flex-wrap:wrap; gap:6px; }
.graph-caption { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; font-size:12px; color:var(--color-text-secondary); }
@container (min-width:800px) { .graph-body:has(.graph-inspector) { grid-template-columns:minmax(0,1fr) 256px; } }
@container (max-width:420px) { .graph-shell[data-exploring='true'] .graph-stage { height:460px; } .graph-toolbar { gap:4px; } }
`;
