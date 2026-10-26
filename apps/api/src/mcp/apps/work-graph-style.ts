/** A compact, contained workspace bar leaves the host's actual space to the graph. */
export const GRAPH_CSS = String.raw`
body[data-work-graph=active]{background:var(--color-background-primary)}
.graph-shell{--graph-line:var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 15%,transparent));min-width:0;display:flex;flex-direction:column;gap:12px}
.graph-shell p{margin:0}.graph-meta{font-size:12px;line-height:1.4;color:var(--color-text-secondary)}
.graph-shell button{min-height:36px}.graph-shell button:focus-visible,.graph-stage:focus-visible,.graph-menu summary:focus-visible{outline:2px solid var(--color-ring-primary);outline-offset:2px}
.graph-scope{display:flex;align-items:center;gap:8px;min-width:0}
.graph-scope-identity{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.graph-scope-identity>.icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;color:var(--color-text-secondary)}
.graph-scope-identity>.icon svg{width:22px;height:22px}
.graph-scope-text{min-width:0}.graph-scope-text h1{font-size:17px;line-height:1.3;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}
.graph-scope-summary{margin-top:3px!important;font-size:12px;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.graph-kicker{font-size:10px;color:var(--color-text-secondary);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px!important}
.graph-inline-header{padding:0 0 12px;border-bottom:1px solid var(--graph-line)}
.graph-inline-header .graph-scope-identity>.icon{display:none}.graph-inline-header .graph-scope{gap:12px}.graph-inline-header .graph-scope-identity{align-items:start}
.graph-shell[data-exploring=false] .graph-inspector{position:static;max-height:none;box-shadow:none}
.graph-shell[data-exploring=false] .graph-selection-peek{display:none}
.graph-shell[data-exploring=false] .graph-inspector-content{display:flex;flex-direction:column;padding:12px}
.graph-shell[data-exploring=false] .graph-inspector-content>.graph-detail-heading,.graph-shell[data-exploring=false] .graph-inspector-content>h2,.graph-shell[data-exploring=false] .graph-inspector-content>.graph-detail-status{display:flex}
.graph-inline-header h1{font-size:16px}.graph-inline-header .tonal{flex:none;font-size:12px}
.graph-inline{display:grid}.graph-inline-item{border-bottom:1px solid var(--graph-line);min-width:0;padding:4px 0}
.graph-inline-row{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;border:0;border-radius:6px;background:transparent;color:var(--color-text-primary);text-align:left;padding:8px;font:inherit;cursor:pointer}
.graph-inline-row:hover,.graph-inline-row[aria-pressed=true]{background:var(--color-background-secondary)}
.graph-inline-text{display:grid;gap:4px;flex:1;min-width:0}.graph-inline-text strong{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:var(--font-text-md-size);line-height:1.4;font-weight:500;overflow-wrap:anywhere}
.graph-inline-open{color:var(--color-text-secondary);font-size:20px}.graph-inline-link{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--color-text-secondary);font-size:11px;margin:4px 8px 0 36px}
.graph-inline-completed{margin:0 0 8px 28px;font-size:12px!important}.graph-inline-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.graph-body{position:relative;min-width:0;display:grid;gap:12px}.graph-shell[data-exploring=true]{gap:0}
body[data-work-graph=active][data-display-mode=fullscreen],body[data-work-graph=active][data-display-mode=fullscreen] .card{height:100dvh;min-height:0;overflow:hidden}
body[data-work-graph=active][data-display-mode=fullscreen] .card{padding:0;gap:0;position:relative}
body[data-work-graph=active][data-display-mode=fullscreen] .content{display:flex;flex-direction:column;flex:1;min-height:0}
body[data-work-graph=active][data-display-mode=fullscreen] .graph-shell{flex:1;min-height:0;height:100%}
body[data-work-graph=active]:not([data-display-mode=fullscreen]) .graph-shell[data-exploring=true]{height:var(--graph-explorer-height,640px);overflow:hidden;border:1px solid var(--graph-line);border-radius:12px}
body[data-work-graph=active][data-display-mode=fullscreen] .status:not([hidden]){position:absolute;bottom:calc(12px + var(--docket-safe-bottom,0px));left:12px;right:12px;z-index:50;padding:12px;border:1px solid var(--color-text-tertiary);background:var(--color-background-primary);border-radius:8px}
body[data-work-graph=active] .status:not([hidden]){display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid var(--color-border-secondary,color-mix(in srgb,var(--color-text-primary) 15%,transparent));border-radius:8px;background:var(--color-background-primary);font-size:var(--font-text-sm-size)}
body[data-work-graph=active] .status[data-tone=error]{background:var(--color-background-danger)}
body[data-work-graph=active] .status button{min-height:40px;flex:none}
body[data-work-graph=active] .card:has(.graph-workspace-header[aria-busy=true]) .status:not([data-tone=error]){position:absolute;width:1px;height:1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.graph-workspace-header{position:relative;z-index:10;display:grid;grid-template-columns:minmax(0,1fr) 40px;gap:8px 12px;align-items:center;padding:calc(10px + var(--docket-safe-top,env(safe-area-inset-top,0px))) calc(12px + var(--docket-safe-right,0px)) 10px calc(12px + var(--docket-safe-left,0px));background:var(--color-background-primary);border-bottom:1px solid var(--graph-line)}
.graph-workspace-header>.graph-scope{grid-column:1;grid-row:1}.graph-workspace-header>.graph-menu{grid-column:2;grid-row:1}.graph-workspace-header>.graph-search-row{grid-column:1/-1;grid-row:2}
.graph-workspace-header[aria-busy=true]::after{content:"";position:absolute;bottom:-1px;left:0;right:0;height:2px;background:var(--color-text-info)}
.graph-search-row{display:flex;align-items:center;gap:8px;min-width:0}.graph-search-wrap{position:relative;flex:1;min-width:0;z-index:20}
.graph-search-wrap .search{background:var(--color-background-secondary);padding:0 10px;min-height:40px;border:1px solid transparent}.graph-search-wrap input{width:100%;min-width:0;min-height:40px}
.graph-search-results{position:absolute;top:calc(100% + 6px);left:0;width:min(360px,calc(100cqw - 24px - var(--docket-safe-left,0px) - var(--docket-safe-right,0px)));max-height:min(360px,calc(100dvh - 160px));overflow:auto;border:1px solid var(--graph-line);border-radius:10px;background:var(--color-background-primary);box-shadow:0 8px 24px #0002;padding:6px}
.graph-search-results[hidden]{display:none}.graph-search-results button{display:grid;width:100%;gap:4px;text-align:left;justify-content:start;padding:10px;white-space:normal;overflow-wrap:anywhere;border:0;min-height:44px}
.graph-search-results button strong{font-size:var(--font-text-sm-size);font-weight:500}.graph-search-results [aria-selected=true]{background:var(--color-background-secondary)}.graph-search-summary{font-size:11px;color:var(--color-text-secondary);padding:8px}
.graph-match-nav{display:flex;align-items:center;gap:4px;flex:none}.graph-match-nav .graph-meta{white-space:nowrap;font-variant-numeric:tabular-nums}.graph-match-nav button{min-width:40px}
.graph-menu{position:relative;min-width:0}.graph-menu summary{display:flex;align-items:center;justify-content:center;cursor:pointer;list-style:none;min-height:40px;min-width:40px;border-radius:8px;color:var(--color-text-secondary)}
.graph-menu summary::-webkit-details-marker{display:none}.graph-menu summary:hover,.graph-menu[open] summary{background:var(--color-background-secondary)}
.graph-menu-panel{position:absolute;right:0;top:calc(100% + 8px);z-index:30;width:min(288px,calc(100cqw - 24px));padding:12px;display:grid;gap:8px;max-height:calc(100dvh - 96px);overflow:auto;background:var(--color-background-primary);border:1px solid var(--graph-line);border-radius:12px;box-shadow:0 8px 24px #0002}
.graph-menu-panel>button{justify-content:start;min-height:40px}.graph-menu-field{display:grid;gap:6px;font-size:12px;color:var(--color-text-secondary)}.graph-menu-field select{width:100%;min-height:40px;font-size:13px}
.graph-menu-counts{display:flex;gap:6px 12px;flex-wrap:wrap;border-top:1px solid var(--graph-line);padding-top:12px;font-size:12px;color:var(--color-text-secondary)}.graph-menu-help{font-size:11px;line-height:1.4;color:var(--color-text-secondary)}
.graph-menu-inline summary{font-size:12px;min-height:40px;justify-content:start;padding:0 8px}.graph-menu-inline .graph-menu-panel{position:static;width:auto;box-shadow:none;margin-top:8px}.graph-menu-inline{flex:none;min-width:0;margin-left:auto}
.graph-shell[data-exploring=true] .graph-body{display:block;flex:1;min-height:0;overflow:hidden}
.graph-stage{position:absolute;inset:0;overflow:hidden;min-width:0;touch-action:none;background:var(--color-background-secondary);background-image:radial-gradient(color-mix(in srgb,var(--color-text-primary) 12%,transparent) .7px,transparent .7px);background-size:24px 24px}
.graph-world{position:absolute;inset:0 auto auto 0;transform-origin:0 0}.graph-edges{z-index:1;position:absolute;inset:0;overflow:visible;pointer-events:none}
.graph-edges path{fill:none;stroke:var(--color-text-secondary);stroke-width:1.5}.graph-edges path[data-traced=true]{stroke:var(--color-text-info);stroke-width:3}.graph-edges path.contribution{stroke-dasharray:4 5}
.graph-edge-label{font-size:11px;fill:var(--color-text-secondary);paint-order:stroke;stroke:var(--color-background-secondary);stroke-width:4px;stroke-linejoin:round}
.graph-group{position:absolute;z-index:0;border:1px dashed var(--color-text-tertiary);border-radius:12px;background:var(--color-background-primary);pointer-events:none}
.graph-group[data-kind=project]{border-style:solid}.graph-group[data-kind=project]::before{content:"";position:absolute;inset:0 0 auto;height:62px;background:var(--color-background-tertiary);border-radius:11px 11px 0 0;border-bottom:1px solid var(--graph-line)}
.graph-node{z-index:2;position:absolute;display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:8px;border:1px solid var(--graph-line);border-radius:8px;background:var(--color-background-primary);padding:12px;color:var(--color-text-primary);font:inherit;text-align:left;overflow:hidden;cursor:pointer;box-shadow:0 1px 3px #0000000a}
.graph-node[data-kind=project]{background:var(--color-background-tertiary);border-top:3px solid var(--color-text-tertiary);border-radius:12px}
.graph-node[data-container=true]{background:transparent;border-color:transparent;box-shadow:none;padding:8px 16px;gap:4px}
.graph-node[data-kind=project][data-container=true]{border-top:0;background:var(--color-background-tertiary);border-radius:10px 0 0 0}
.graph-node[data-container=true] .graph-node-name{-webkit-line-clamp:1;font-weight:600}.graph-node[aria-pressed=true]{border-color:var(--color-text-info);box-shadow:0 0 0 1px var(--color-text-info)}
.graph-node[data-muted=true]{border-style:dashed}.graph-node[data-traced=true]{box-shadow:0 0 0 2px var(--color-text-info)}
.graph-node-heading,.graph-detail-name,.graph-detail-section h3,.graph-inspector h2{display:flex;align-items:center;gap:8px;min-width:0}.graph-node-heading .icon{flex:none;color:var(--color-text-secondary)}
.graph-node-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-width:0;flex:1;font-weight:500;font-size:var(--font-text-md-size);line-height:1.35}
.graph-node-meta{display:flex;gap:8px;align-items:center;color:var(--color-text-secondary);font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.graph-node-meta .glyph{flex:none}
.graph-group-toggle{position:absolute;z-index:3;min-width:40px;min-height:40px;padding:2px!important}
.graph-map-controls{position:absolute;z-index:4;left:calc(12px + var(--docket-safe-left,0px));bottom:calc(12px + var(--docket-safe-bottom,0px));display:flex;gap:0;max-width:calc(100% - 24px);padding:4px;border:1px solid var(--graph-line);border-radius:10px;background:var(--color-background-primary);box-shadow:0 2px 8px #0001}
.graph-map-controls button{min-width:40px;min-height:40px;padding:4px}.graph-body:has(.graph-inspector) .graph-map-controls{bottom:calc(var(--graph-panel-height,128px) + 20px + var(--docket-safe-bottom,0px))}
.graph-inspector{position:absolute;z-index:5;bottom:calc(8px + var(--docket-safe-bottom,0px));left:calc(8px + var(--docket-safe-left,0px));right:calc(8px + var(--docket-safe-right,0px));min-width:0;max-height:70%;border:1px solid var(--graph-line);border-radius:12px;background:var(--color-background-primary);box-shadow:0 4px 24px #0002;overflow:hidden;display:flex;flex-direction:column}
.graph-selection-peek{padding:12px;display:grid;gap:8px;flex:none}.graph-peek-heading{display:flex;align-items:center;gap:8px}.graph-peek-title{min-width:0;flex:1}.graph-inspector h2{font-size:16px;line-height:1.35;font-weight:600;margin:0;overflow-wrap:anywhere}
.graph-peek-title h2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.graph-peek-title .graph-meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}
.graph-peek-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}.graph-peek-need{display:grid;align-content:center;text-align:left;justify-content:start;min-width:0;flex:1;gap:2px!important;padding:0!important;white-space:normal}
.graph-peek-need>span:last-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:100%;font-size:12px;color:var(--color-text-primary)}.graph-peek-label{font-size:11px;color:var(--color-text-secondary)}
.graph-inspector-content{display:none;overflow:auto;min-height:0;gap:12px;padding:0 12px 12px;flex:1}.graph-inspector[data-expanded=true] .graph-inspector-content{display:flex;flex-direction:column}
.graph-inspector-content>.graph-detail-heading,.graph-inspector-content>h2,.graph-inspector-content>.graph-detail-status{display:none}
.graph-inspector[data-expanded=true] .graph-peek-need{visibility:hidden}.graph-inspector[data-expanded=true] .graph-selection-peek{border-bottom:1px solid var(--graph-line);margin-bottom:12px}
.graph-detail-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.graph-detail-status{display:flex;align-items:center;gap:8px}
.graph-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.graph-primary-actions .tonal{padding-inline:8px}.graph-detail-section{border-top:1px solid var(--graph-line);padding-top:12px;display:grid;gap:4px}.graph-detail-section h3{font-size:12px;font-weight:600;margin:0}
.graph-detail-link{display:grid!important;gap:4px!important;text-align:left!important;white-space:normal!important;overflow-wrap:anywhere;font-size:var(--font-text-sm-size)!important;padding:8px 0!important;justify-content:start!important}
.graph-detail-link>.graph-meta{padding-left:24px}.graph-detail-action{display:inline-block;white-space:nowrap}.graph-detail-name>.icon,.graph-detail-name>.glyph{flex:none}
.graph-icon-incoming>.icon,.graph-detail-section .graph-icon-incoming{transform:rotate(180deg)}
.graph-location{display:flex;align-items:center;gap:8px;min-width:0;color:var(--color-text-secondary);font-size:11px;flex:1;flex-wrap:wrap}.graph-location>span{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden}.graph-location .icon{display:inline-flex;flex:none}
.graph-location-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.graph-location-separator{flex:none!important;color:var(--color-text-tertiary)}
.graph-paging{position:absolute;top:12px;right:calc(12px + var(--docket-safe-right,0px));display:flex;align-items:center;gap:8px;padding:4px 8px;border:1px solid var(--graph-line);border-radius:8px;background:var(--color-background-primary);z-index:4;max-width:calc(100% - 24px)}
.graph-paging .graph-meta{white-space:nowrap;font-variant-numeric:tabular-nums}.graph-paging button{min-width:40px}
.graph-shell[data-exploring=true] .graph-relations{height:100%;overflow:auto;box-sizing:border-box;padding:16px 16px 180px;display:grid;align-content:start;gap:8px;background:var(--color-background-primary)}
.graph-relation{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 0}.graph-relation button{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}
.graph-empty{display:grid;align-content:center;justify-items:start;gap:12px;padding:32px;font-size:14px;height:100%;box-sizing:border-box}
.graph-shell button{min-width:40px;min-height:40px}
@container(min-width:900px){
 .graph-workspace-header{grid-template-columns:minmax(220px,1fr) minmax(280px,420px) 40px;gap:24px;padding:calc(12px + var(--docket-safe-top,0px)) calc(16px + var(--docket-safe-right,0px)) 12px calc(16px + var(--docket-safe-left,0px))}
 .graph-workspace-header>.graph-scope{grid-column:1}.graph-workspace-header>.graph-search-row{grid-column:2;grid-row:1}.graph-workspace-header>.graph-menu{grid-column:3;grid-row:1}
 .graph-selection-peek{display:none}.graph-inspector{top:16px;right:calc(16px + var(--docket-safe-right,0px));bottom:auto;left:auto;width:300px;max-height:calc(100% - 32px)}
 .graph-inspector-content{display:flex;padding:16px;flex-direction:column}.graph-inspector-content>.graph-detail-heading{display:flex}.graph-inspector-content>h2,.graph-inspector-content>.graph-detail-status{display:flex}
 .graph-body:has(.graph-inspector) .graph-map-controls{bottom:calc(16px + var(--docket-safe-bottom,0px))}.graph-map-controls{left:calc(16px + var(--docket-safe-left,0px));bottom:calc(16px + var(--docket-safe-bottom,0px))}
 .graph-shell[data-exploring=true] .graph-relations{padding-right:340px;padding-bottom:16px}
}
@media(prefers-reduced-motion:reduce){.graph-shell *{scroll-behavior:auto!important;transition:none!important}}
`;
