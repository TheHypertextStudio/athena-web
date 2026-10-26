/** Frame against the actual unoccluded container while letting the canvas fill the entire host area. */
export const GRAPH_CAMERA_SCRIPT = String.raw`
window.docketGraphCamera = function (state) {
  let stage, world, observer, lastArea;
  function area() {
    if (!stage) return { x: 0, y: 0, width: 1, height: 1 };
    const insets = window.docket.hostContext.safeAreaInsets || {};
    let left = 12 + (insets.left || 0),
      top = 12,
      right = stage.clientWidth - 12 - (insets.right || 0),
      bottom = stage.clientHeight - 12 - (insets.bottom || 0);
    const panel = stage.parentElement.querySelector('.graph-inspector'),
      controls = stage.parentElement.querySelector('.graph-map-controls');
    if (panel) {
      stage.parentElement.style.setProperty('--graph-panel-height', panel.offsetHeight + 'px');
      if (document.body.clientWidth >= 900) right = Math.min(right, panel.offsetLeft - 16);
      else bottom = Math.min(bottom, panel.offsetTop - 12);
    }
    if (controls) bottom = Math.min(bottom, controls.offsetTop - 12);
    const paging = stage.parentElement.querySelector('.graph-paging');
    if (paging) top = Math.max(top, paging.offsetTop + paging.offsetHeight + 12);
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
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
  function rect(n) {
    return { x: n.x, y: n.y, width: Math.min(n.width, 238), height: n.childCount ? 62 : n.height };
  }
  function frame(key) {
    if (!stage?.isConnected) return;
    const s = state.snapshot,
      n =
        s.nodes.find((n) => n.key === key) ||
        s.nodes.find((n) => !n.parentKey && !n.external) ||
        s.nodes[0];
    if (!n) return;
    const view = area(),
      related = new Set(
        s.edges
          .filter((e) => e.source === n.key || e.target === n.key)
          .flatMap((e) => [e.source, e.target]),
      );
    const nearby = s.nodes.filter(
      (other) => other.key !== n.key && (related.has(other.key) || other.parentKey === n.key),
    );
    nearby.sort(
      (a, b) =>
        Math.abs(a.x - n.x) + Math.abs(a.y - n.y) - (Math.abs(b.x - n.x) + Math.abs(b.y - n.y)),
    );
    let bounds = rect(n);
    const join = (a, b) => ({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
      height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
    });
    for (const nextNode of nearby.slice(0, 4)) {
      const next = join(bounds, rect(nextNode));
      if (next.width * 0.86 <= view.width - 24 && next.height * 0.86 <= view.height - 24)
        bounds = next;
    }
    const scale = Math.max(
      0.86,
      Math.min(1, (view.width - 24) / bounds.width, (view.height - 24) / bounds.height),
    );
    state.camera = {
      scale,
      x: view.x + (view.width - bounds.width * scale) / 2 - bounds.x * scale,
      y: view.y + Math.max(12, (view.height - bounds.height * scale) * 0.28) - bounds.y * scale,
    };
    lastArea = view;
    transform();
  }
  function ensureVisible(key) {
    if (!stage?.isConnected || !key) return;
    const element = world.querySelector('[data-graph-select="' + CSS.escape(key) + '"]');
    if (!element) return;
    const box = element.getBoundingClientRect(),
      base = stage.getBoundingClientRect(),
      view = area();
    if (
      box.left < base.left + view.x ||
      box.left + Math.min(box.width, 238 * (state.camera?.scale || 1)) >
        base.left + view.x + view.width ||
      box.top < base.top + view.y ||
      box.bottom > base.top + view.y + view.height
    )
      frame(key);
  }
  function fit() {
    if (!stage?.isConnected) return;
    const view = area();
    const scale = Math.max(
      0.001,
      Math.min(
        1,
        (view.width - 24) / state.snapshot.width,
        (view.height - 24) / state.snapshot.height,
      ),
    );
    state.camera = {
      scale,
      x: view.x + (view.width - state.snapshot.width * scale) / 2,
      y: view.y + (view.height - state.snapshot.height * scale) / 2,
    };
    state.cameraTouched = true;
    lastArea = view;
    transform();
  }
  function zoom(factor) {
    if (!stage?.isConnected || !state.camera) return;
    const view = area(),
      c = state.camera,
      scale = Math.max(0.001, Math.min(2, c.scale * factor)),
      x = view.x + view.width / 2,
      y = view.y + view.height / 2;
    state.camera = {
      scale,
      x: x - ((x - c.x) * scale) / c.scale,
      y: y - ((y - c.y) * scale) / c.scale,
    };
    state.cameraTouched = true;
    transform();
  }
  function resize() {
    if (!stage?.isConnected) return;
    const view = area(),
      changed =
        !lastArea || ['x', 'y', 'width', 'height'].some((k) => Math.abs(view[k] - lastArea[k]) > 1);
    if (!state.camera || state.frame) {
      frame(state.frame || state.selected);
      return;
    }
    if (changed) {
      if (state.cameraTouched && lastArea) {
        state.camera = {
          ...state.camera,
          x: state.camera.x + view.x + view.width / 2 - lastArea.x - lastArea.width / 2,
          y: state.camera.y + view.y + view.height / 2 - lastArea.y - lastArea.height / 2,
        };
      } else {
        frame(state.selected);
        return;
      }
    }
    lastArea = view;
    transform();
  }
  function attach(nextStage, nextWorld) {
    observer?.disconnect();
    stage = nextStage;
    world = nextWorld;
    let drag;
    stage.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button') || !state.camera) return;
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
    for (const type of ['pointerup', 'pointercancel'])
      stage.addEventListener(type, () => {
        drag = null;
      });
    stage.addEventListener('keydown', (event) => {
      if (event.target !== stage || !state.camera) return;
      const delta = {
        ArrowLeft: [40, 0],
        ArrowRight: [-40, 0],
        ArrowUp: [0, 40],
        ArrowDown: [0, -40],
      }[event.key];
      if (delta) {
        event.preventDefault();
        state.cameraTouched = true;
        state.camera.x += delta[0];
        state.camera.y += delta[1];
        transform();
      }
    });
    requestAnimationFrame(() => {
      if (state.frame) {
        frame(state.frame);
        state.frame = null;
      } else resize();
      if ('ResizeObserver' in window) {
        observer = new ResizeObserver(resize);
        observer.observe(stage);
        const panel = stage.parentElement.querySelector('.graph-inspector');
        if (panel) observer.observe(panel);
      }
    });
  }
  return { attach, frame, fit, zoom, ensureVisible, resize };
};
`;
