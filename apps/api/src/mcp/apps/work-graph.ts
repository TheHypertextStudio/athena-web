/** Shared controller for the standalone graph and graph views opened from existing cards. */
import { appDocument } from './runtime';
import { GRAPH_CSS } from './work-graph-style';
import { GRAPH_RENDER_SCRIPT } from './work-graph-render';

const CONTROLLER = String.raw`
(() => {
  const d = window.docket;
  const css = document.createElement('style');
  css.textContent = window.__docketGraphCss;
  document.head.appendChild(css);
  function create() {
    const state = {
      active: false,
      snapshot: null,
      args: {},
      selected: null,
      trace: new Set(),
      search: '',
      list: false,
      exploring: false,
      camera: null,
      cameraTouched: false,
      back: null,
      history: [],
      serial: 0,
      busy: false,
    };
    let stage = null,
      world = null,
      resizeTimer = null;
    const viewport = () =>
      document.documentElement.clientWidth < 480
        ? 'portrait'
        : document.documentElement.clientWidth < 800
          ? 'square'
          : 'landscape';
    const draw = () => {
      if (!state.active || !state.snapshot) return;
      document.body.dataset.workGraph = 'active';
      const snapshot = state.snapshot;
      const root = d.canvas();
      const shell = d.el('div', 'graph-shell');
      shell.dataset.exploring = String(state.exploring || d.fullscreen);
      root.appendChild(shell);
      const nav = d.el('div', 'graph-actions');
      if (state.back || state.history.length) nav.appendChild(d.button('Back', back));
      if (state.history.length)
        nav.appendChild(
          d.el('span', 'graph-meta', state.history.map((h) => h.snapshot.scope.title).join(' / ')),
        );
      if (nav.childNodes.length) shell.appendChild(nav);
      shell.appendChild(
        d.header({ kind: snapshot.scope.kind, kicker: 'Work graph', title: snapshot.scope.title }),
      );
      const summary = d.el('div', 'graph-summary');
      for (const [key, label] of [
        ['remaining', 'remaining'],
        ['completed', 'completed'],
        ['canceled', 'canceled'],
      ]) {
        const item = d.el('span');
        item.appendChild(d.el('strong', '', String(snapshot.totals[key])));
        item.appendChild(document.createTextNode(' ' + label));
        summary.appendChild(item);
      }
      shell.appendChild(summary);
      shell.appendChild(toolbar());
      if (snapshot.completedGroups.length) {
        const done = d.el('div', 'graph-done');
        for (const group of snapshot.completedGroups)
          done.appendChild(
            d.button(
              group.count + ' completed · ' + group.title,
              () => read({ completion: 'all', focus: group.focus, page: 0 }),
              { label: 'Expand completed work in ' + group.title },
            ),
          );
        shell.appendChild(done);
      }
      const body = d.el('div', 'graph-body');
      if (!snapshot.nodes.length) {
        const empty = d.el('div', 'graph-empty');
        empty.appendChild(
          d.el(
            'p',
            '',
            snapshot.totals.total ? 'No remaining work in this view' : 'No work recorded here yet',
          ),
        );
        if (snapshot.totals.total)
          empty.appendChild(
            d.button('Show everything', () => read({ completion: 'all', page: 0 })),
          );
        body.appendChild(empty);
      } else
        body.appendChild(
          state.list
            ? window.docketGraphRender.relationList(state, actions)
            : window.docketGraphRender.stage(state, actions),
        );
      const detail = window.docketGraphRender.inspector(state, actions);
      if (detail) body.appendChild(detail);
      shell.appendChild(body);
      const caption = d.el('div', 'graph-caption');
      caption.appendChild(
        d.el(
          'span',
          '',
          snapshot.nodes.length +
            ' in this scene' +
            (snapshot.omitted ? ' · ' + snapshot.omitted + ' more outside this scene' : ''),
        ),
      );
      caption.appendChild(
        d.el('span', '', 'As of ' + d.time(snapshot.asOf, { hour: 'numeric', minute: '2-digit' })),
      );
      shell.appendChild(caption);
      const legend = d.el('div', 'graph-legend');
      legend.appendChild(d.el('span', '', '→ Blocks'));
      legend.appendChild(d.el('span', '', 'Dashed groups contain work · Dotted links contribute'));
      shell.appendChild(legend);
      if (snapshot.boundaries.length)
        shell.appendChild(
          d.el(
            'p',
            'graph-meta',
            'Some recorded connections continue outside this scene. Select work to explore its neighborhood.',
          ),
        );
      const paging = d.el('div', 'graph-actions');
      if (snapshot.page > 0)
        paging.appendChild(d.button('Previous page', () => read({ page: snapshot.page - 1 })));
      if ((state.exploring || d.fullscreen) && snapshot.hasNextPage)
        paging.appendChild(
          d.button('Next page', () => read({ page: snapshot.page + 1, display: 'fullscreen' })),
        );
      if (paging.childNodes.length) shell.appendChild(paging);
      if (stage && world && !state.list)
        requestAnimationFrame(() => {
          if (!state.camera) fit(false);
          else transform();
        });
      d.resize();
    };
    function toolbar() {
      const bar = d.el('div', 'graph-toolbar');
      const modes = [
        ['collapsed', 'Completed collapsed'],
        ['all', 'Show everything'],
        ['remaining', 'Remaining work'],
      ];
      const select = d.el('select');
      select.setAttribute('aria-label', 'Completed work display');
      for (const [value, label] of modes) {
        const option = d.el('option', '', label);
        option.value = value;
        select.appendChild(option);
      }
      select.value = state.args.completion || 'collapsed';
      select.addEventListener('change', () => read({ completion: select.value, page: 0 }));
      bar.appendChild(select);
      if (!state.exploring && !d.fullscreen)
        bar.appendChild(
          d.button(
            'Explore graph',
            async () => {
              state.exploring = true;
              const mode = await d.requestDisplayMode('fullscreen');
              state.exploring = mode !== 'fullscreen';
              await read({ display: 'fullscreen', viewport: viewport() });
              if (mode !== 'fullscreen') draw();
            },
            { tonal: true },
          ),
        );
      if (state.exploring || d.fullscreen) {
        bar.appendChild(d.button('−', () => zoom(0.8), { label: 'Zoom out' }));
        bar.appendChild(d.button('+', () => zoom(1.25), { label: 'Zoom in' }));
        bar.appendChild(d.button('Fit', () => fit(true)));
      }
      bar.appendChild(
        d.button(state.list ? 'Map' : 'Relationship list', () => {
          state.list = !state.list;
          draw();
        }),
      );
      bar.appendChild(
        d.button(state.busy ? 'Refreshing…' : 'Refresh', () => read({}), {
          label: 'Refresh graph',
        }),
      );
      if (state.exploring || d.fullscreen) {
        const search = d.search('Find work', state.search, (value) => {
          state.search = value;
          for (const n of document.querySelectorAll('.graph-node')) {
            const item = state.snapshot.nodes.find((item) => item.key === n.dataset.key);
            n.dataset.muted = String(
              !item.matched || !item.title.toLowerCase().includes(value.toLowerCase()),
            );
          }
        });
        search.classList.add('graph-search');
        bar.appendChild(search);
      }
      return bar;
    }
    function transform() {
      if (world && state.camera)
        world.style.transform =
          'translate(' +
          state.camera.x +
          'px,' +
          state.camera.y +
          'px) scale(' +
          state.camera.scale +
          ')';
    }
    function fit(whole) {
      if (whole) state.cameraTouched = true;
      if (!stage || !state.snapshot) return;
      const s = Math.min(
        (stage.clientWidth - 24) / state.snapshot.width,
        (stage.clientHeight - 24) / state.snapshot.height,
        1,
      );
      const scale = whole ? Math.max(0.08, s) : Math.max(0.72, s);
      state.camera = { x: 12, y: 12, scale };
      transform();
    }
    function zoom(factor) {
      state.cameraTouched = true;
      if (!state.camera) return;
      state.camera.scale = Math.max(0.08, Math.min(2, state.camera.scale * factor));
      transform();
    }
    function attach(nextStage, nextWorld) {
      stage = nextStage;
      world = nextWorld;
      let drag = null;
      stage.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button') || !(state.exploring || d.fullscreen)) return;
        state.cameraTouched = true;
        drag = { x: event.clientX, y: event.clientY, camera: { ...state.camera } };
        stage.setPointerCapture(event.pointerId);
      });
      stage.addEventListener('pointermove', (event) => {
        if (!drag) return;
        state.camera = {
          ...drag.camera,
          x: drag.camera.x + event.clientX - drag.x,
          y: drag.camera.y + event.clientY - drag.y,
        };
        transform();
      });
      stage.addEventListener('pointerup', () => {
        drag = null;
      });
      stage.addEventListener('pointercancel', () => {
        drag = null;
      });
      stage.addEventListener('keydown', (event) => {
        if (event.target !== stage || !state.camera) return;
        const movement = {
          ArrowLeft: [40, 0],
          ArrowRight: [-40, 0],
          ArrowUp: [0, 40],
          ArrowDown: [0, -40],
        }[event.key];
        if (movement) {
          event.preventDefault();
          state.camera.x += movement[0];
          state.camera.y += movement[1];
          transform();
        }
      });
    }
    async function read(changes) {
      const serial = ++state.serial;
      const args = Object.assign({}, state.args, changes);
      state.busy = true;
      d.notice('Loading graph…');
      try {
        const result = await d.call('view_work_graph', args);
        if (serial !== state.serial) return;
        const snapshot = result && result.structuredContent;
        if (result.isError || !snapshot || !Array.isArray(snapshot.nodes))
          throw new Error('unavailable');
        state.args = {...args,expanded:snapshot.expanded};
        state.snapshot = snapshot;
        if(typeof changes.focus==='string')state.selected=changes.focus;
        if (!state.cameraTouched) state.camera = null;
        state.active = true;
        state.busy = false;
        d.notice('');
        draw();
        return true;
      } catch {
        if (serial !== state.serial) return;
        state.busy = false;
        d.notice(
          'The graph could not be loaded. Your previous view is preserved. Try Refresh or reopen the graph.',
          'error',
        );
        return false;
      }
    }
    function select(key) {
      state.selected = key;
      state.trace.clear();
      draw();
      const n = state.snapshot.nodes.find((n) => n.key === key);
      if (n)
        void d
          .updateContext({
            structuredContent: {
              orgId: state.args.orgId,
              scope: state.args.scope,
              selected: { kind: n.kind, id: n.id, title: n.title },
              asOf: state.snapshot.asOf,
            },
          })
          .catch(() => {});
      requestAnimationFrame(() =>
        document
          .querySelector('[data-graph-select="' + CSS.escape(key) + '"]')
          ?.focus({ preventScroll: true }),
      );
    }
    function trace(direction) {
      state.trace.clear();
      if (direction !== 'clear' && state.selected) {
        state.trace.add(state.selected);
        let frontier = [state.selected];
        while (frontier.length) {
          const next = [];
          for (const e of state.snapshot.edges) {
            const from = direction === 'before' ? e.target : e.source,
              to = direction === 'before' ? e.source : e.target;
            if (frontier.includes(from) && !state.trace.has(to)) {
              state.trace.add(to);
              next.push(to);
            }
          }
          frontier = next;
        }
      }
      draw();
    }
    async function expand(key) {
      const expanded = new Set(state.args.expanded || []);
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      await read({ expanded: [...expanded], focus:undefined, display: 'fullscreen', page: 0 });
    }
    async function scope(next) {
      const previous = {
        snapshot: state.snapshot,
        args: { ...state.args },
        camera: state.camera,
        selected: state.selected,
      };
      state.camera = null;
      const loaded = await read({
        scope: next,
        page: 0,
        expanded: [],
        focus: next.kind + ':' + next.id,
      });
      if (loaded) {
        state.history.push(previous);
        draw();
      } else state.camera = previous.camera;
    }
    function back() {
      state.serial++;
      state.busy = false;
      const previous = state.history.pop();
      if (previous) {
        Object.assign(state, previous);
        draw();
        return;
      }
      state.active = false;
      delete document.body.dataset.workGraph;
      if (state.back) state.back();
    }
    async function ask(n) {
      try {
        await d.say(
          'What would unblock “' +
            n.title +
            '”, and what would completing it unlock? Docket ' +
            n.kind +
            ' ' +
            n.id +
            ' in workspace ' +
            state.args.orgId +
            '. Graph snapshot ' +
            state.snapshot.asOf +
            '.',
        );
      } catch {
        d.notice(
          'Your host could not send the question. Ask about “' + n.title + '” in the conversation.',
          'error',
        );
      }
    }
    const actions = { select, expand, scope, trace, ask, attach };
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.active && state.args.viewport !== viewport()) void read({ viewport: viewport() });
      }, 180);
    });
    return {
      get active() {
        return state.active;
      },
      draw,
      async open(scopeValue, orgId, onBack, focusKeys, listInput) {
        state.back = onBack;
        state.history = [];
        state.args = {
          orgId,
          scope: scopeValue,
          completion: 'collapsed',
          expanded: [],
          display: d.fullscreen ? 'fullscreen' : 'inline',
          viewport: viewport(),
          focusKeys: focusKeys || [],
        };
        if (listInput) {
          const {
            orgId: ignoredOrg,
            entity: ignoredEntity,
            limit: ignoredLimit,
            cursor: ignoredCursor,
            ...filters
          } = listInput;
          state.args.focusFilter = filters;
        }
        state.camera = null;
        await read({});
      },
      show(snapshot, args) {
        state.snapshot = snapshot;
        state.args = Object.assign(
          { completion: 'collapsed', expanded: [], display: 'inline', viewport: 'landscape' },
          args,
        );
        state.args.expanded=snapshot.expanded;
        state.active = true;
        state.selected = args.focus || null;
        draw();
        if (state.args.viewport !== viewport()) void read({ viewport: viewport() });
      },
      mode() {
        if (!state.active) return false;
        const mode = d.fullscreen || state.exploring ? 'fullscreen' : 'inline';
        if (state.args.display !== mode || state.args.viewport !== viewport())
          void read({ display: mode, viewport: viewport() });
        else draw();
        return true;
      },
    };
  }
  window.docketGraph = { create };
})();

`;

/** Install the same renderer/controller in graph, entity and scoped-list resources. */
export const GRAPH_SCRIPT = `window.__docketGraphCss=${JSON.stringify(GRAPH_CSS)};\n${GRAPH_RENDER_SCRIPT}\n${CONTROLLER}`;
/** Standalone graph resource, using the existing host protocol and loading shell. */
export const WORK_GRAPH_HTML = appDocument(
  'Work graph',
  `${GRAPH_SCRIPT}\n(() => {
  const graph=window.docketGraph.create();
  window.docket.onDisplayMode(()=>graph.mode());
  window.docket.onData(data=>graph.show(data,window.docket.input));
})();`,
  { skeletonRows: 4 },
);
