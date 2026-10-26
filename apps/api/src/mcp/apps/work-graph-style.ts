/** Host-themed density and spatial hierarchy for conversation slices and expanded explorers. */
export const GRAPH_CSS = String.raw`
body[data-work-graph='active']{background:var(--color-background-primary)}
.graph-shell{display:flex;flex-direction:column;gap:12px;min-width:0}
.graph-shell p{margin:0}
.graph-heading{display:flex;align-items:center;gap:12px;min-width:0}
.graph-title{flex:1;min-width:0}
.graph-title h1{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:var(--font-heading-sm-size);line-height:1.25;font-weight:600;margin:4px 0 0;overflow-wrap:anywhere}
.graph-kicker{color:var(--color-text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.graph-toolbar,.graph-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.graph-actions button{min-height:32px}
.graph-meta{color:var(--color-text-secondary);font-size:12px;line-height:1.4}
.graph-summary{display:flex;flex-wrap:wrap;gap:16px;font-size:var(--font-text-sm-size);color:var(--color-text-secondary)}
.graph-summary strong{color:var(--color-text-primary);font-weight:600;font-variant-numeric:tabular-nums}
.graph-options summary{font-size:12px;color:var(--color-text-secondary);cursor:pointer;padding:2px 0}
.graph-options[open] .graph-actions{padding-top:8px}
.graph-inline{display:grid;border-top:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 14%,transparent))}
.graph-inline-item{border-bottom:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 14%,transparent));min-width:0;padding:4px 0}
.graph-inline-row{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;border:0;border-radius:6px;background:transparent;color:var(--color-text-primary);text-align:left;padding:8px;font:inherit;cursor:pointer}
.graph-inline-row:hover,.graph-inline-row[aria-pressed=true]{background:var(--color-background-secondary)}
.graph-inline-text{display:grid;gap:4px;flex:1;min-width:0}
.graph-inline-text strong{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:var(--font-text-md-size);line-height:1.4;font-weight:500;overflow-wrap:anywhere}
.graph-inline-open{color:var(--color-text-secondary);font-size:20px}
.graph-inline-link{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--color-text-secondary);font-size:11px;margin:4px 8px 0 36px;overflow-wrap:anywhere}
.graph-inline-completed{margin:0 0 6px 30px;font-size:12px!important}
.graph-body{position:relative;min-width:0;display:grid;gap:12px}
.graph-stage{position:relative;overflow:hidden;min-width:0;min-height:0;border:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 14%,transparent));border-radius:10px;background:var(--color-background-secondary);touch-action:none}
.graph-shell[data-exploring=true] .graph-body{flex:1;min-height:360px}
.graph-shell[data-exploring=true] .graph-stage{height:100%;min-height:360px}
body[data-work-graph=active][data-display-mode=fullscreen] .card{padding:20px;overflow:hidden;box-sizing:border-box}
body[data-work-graph=active][data-display-mode=fullscreen] .content{flex:1;min-height:0;display:flex;flex-direction:column}
body[data-work-graph=active][data-display-mode=fullscreen] .graph-shell{height:100%;min-height:0;flex:1}
body[data-work-graph=active][data-display-mode=fullscreen] .graph-body{min-height:0}
body[data-work-graph=active][data-display-mode=fullscreen] .graph-stage{min-height:0}
body[data-work-graph=active]:not([data-display-mode=fullscreen]) .graph-shell[data-exploring=true] .graph-body{height:560px;flex:none}
.graph-world{position:absolute;inset:0 auto auto 0;transform-origin:0 0}
.graph-edges{z-index:1;position:absolute;inset:0;overflow:visible;pointer-events:none}
.graph-edges path{fill:none;stroke:var(--color-text-secondary);stroke-width:1.5}
.graph-edges path[data-traced=true]{stroke:var(--color-text-info);stroke-width:3}
.graph-edges path.contribution{stroke-dasharray:4 5}
.graph-edge-label{font-size:11px;fill:var(--color-text-secondary);paint-order:stroke;stroke:var(--color-background-secondary);stroke-width:4px;stroke-linejoin:round}
.graph-group{position:absolute;z-index:0;border:1px dashed var(--color-text-tertiary);border-radius:12px;background:var(--color-background-tertiary);pointer-events:none}
.graph-node{z-index:2;position:absolute;display:flex;flex-direction:column;align-items:stretch;gap:4px;border:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 14%,transparent));border-radius:8px;background:var(--color-background-primary);padding:12px;color:var(--color-text-primary);font:inherit;text-align:left;overflow:hidden;cursor:pointer;box-shadow:0 1px 2px #00000008}
.graph-node[data-container=true]{background:transparent;border-color:transparent;box-shadow:none;padding:8px 16px;gap:4px}
.graph-node[data-container=true] .graph-node-kind{display:none}
.graph-node[data-container=true] .graph-node-name{-webkit-line-clamp:1;font-weight:600}
.graph-node[aria-pressed=true]{border-color:var(--color-text-info);box-shadow:0 0 0 1px var(--color-text-info)}
.graph-node[data-muted=true]{border-style:dashed}
.graph-node[data-traced=true]{box-shadow:0 0 0 2px var(--color-text-info)}
.graph-node-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:500;font-size:var(--font-text-md-size);line-height:1.35}
.graph-node-meta{display:flex;gap:8px;align-items:center;color:var(--color-text-secondary);font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.graph-node-kind{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-secondary)}
.graph-group-toggle{position:absolute;z-index:3;min-width:28px;min-height:28px;padding:2px!important}
.graph-map-controls{position:absolute;bottom:12px;left:12px;display:flex;gap:4px;padding:4px;border:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 14%,transparent));border-radius:8px;background:var(--color-background-primary);z-index:4}
.graph-map-controls button{min-width:32px;min-height:32px}
.graph-inspector{display:flex;flex-direction:column;align-self:start;gap:12px;min-width:0;padding:16px;border:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 14%,transparent));border-radius:10px;background:var(--color-background-primary);overflow:auto;max-height:100%;box-sizing:border-box}
.graph-inspector h2{font-size:var(--font-heading-sm-size);line-height:1.35;font-weight:600;margin:0;overflow-wrap:anywhere}
.graph-detail-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.graph-detail-heading>button{min-height:28px}
.graph-detail-status{display:flex;align-items:center;gap:8px}
.graph-detail-section{border-top:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 14%,transparent));padding-top:12px;display:grid;gap:4px}
.graph-detail-section h3{font-size:12px;font-weight:600;margin:0}
.graph-detail-link{display:grid!important;gap:3px!important;text-align:left!important;white-space:normal!important;overflow-wrap:anywhere;font-size:var(--font-text-sm-size)!important;padding:7px 0!important;justify-content:start!important}
.graph-search-wrap{position:relative;flex:1 1 220px;max-width:440px;min-width:0;z-index:10}
.graph-search-wrap .search,.graph-search-wrap input{width:100%;min-width:0;box-sizing:border-box}
.graph-search-results{position:absolute;top:calc(100% + 6px);left:0;right:0;max-height:340px;overflow:auto;border:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 14%,transparent));border-radius:8px;background:var(--color-background-primary);box-shadow:0 8px 24px #0002;padding:6px}
.graph-search-results[hidden]{display:none}
.graph-search-results button{display:grid;width:100%;gap:4px;text-align:left;justify-content:start;padding:9px;white-space:normal;overflow-wrap:anywhere;border:0;min-height:44px}
.graph-search-results button strong{font-size:var(--font-text-sm-size);font-weight:500}
.graph-search-results [aria-selected=true]{background:var(--color-background-secondary)}
.graph-search-summary{font-size:11px;color:var(--color-text-secondary);padding:8px}
.graph-relations{display:grid;gap:8px;overflow:auto;align-content:start}
.graph-relation{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0}
.graph-relation button{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}
.graph-empty{display:grid;align-content:center;justify-items:start;gap:12px;padding:24px 8px;font-size:var(--font-text-md-size)}
.graph-caption{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:11px;color:var(--color-text-secondary)}
.graph-shell button:focus-visible,.graph-stage:focus-visible,.graph-options summary:focus-visible{outline:2px solid var(--color-ring-primary);outline-offset:2px}
@media(min-width:800px){.graph-shell[data-exploring=true] .graph-body:has(.graph-inspector){grid-template-columns:minmax(0,1fr) 280px}}
@media(max-width:799px){
 body[data-work-graph=active][data-display-mode=fullscreen] .card{padding:12px}
 .graph-shell[data-exploring=true] .graph-inspector{position:absolute;bottom:0;left:0;right:0;max-height:46%;z-index:5;box-shadow:0 -4px 20px #0001}
 .graph-shell[data-exploring=true] .graph-body:has(.graph-inspector) .graph-map-controls{bottom:calc(46% + 8px)}
 .graph-toolbar>.graph-actions{gap:4px}
 .graph-shell button,.graph-toolbar select,.graph-search-wrap input{min-height:40px}
 .graph-toolbar>.graph-actions button,.graph-toolbar select{font-size:12px;padding:6px}
 .graph-options summary{min-height:40px;display:list-item;list-style-position:inside;padding:12px 0}
 .graph-group-toggle{min-width:40px}
 .graph-detail-link{min-height:40px}
 .graph-map-controls button{min-width:40px}
 .graph-heading{gap:8px}.graph-title h1{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:16px}.graph-heading>button{font-size:12px;white-space:nowrap}
}
@media(prefers-reduced-motion:reduce){.graph-shell *{scroll-behavior:auto!important;transition:none!important}}
`;
