/** Apply standard MCP host dimensions and safe areas without retaining obsolete axis constraints. */
export const HOST_LAYOUT_SCRIPT = String.raw`
window.docketApplyHostLayout = function (context) {
  if (!context) return;
  const root = document.documentElement,
    dims = context.containerDimensions;
  if (dims) {
    for (const axis of ['height', 'width']) {
      const maximum = axis === 'height' ? 'maxHeight' : 'maxWidth',
        cssMaximum = axis === 'height' ? 'max-height' : 'max-width';
      root.style.removeProperty(axis);
      root.style.removeProperty(cssMaximum);
      if (typeof dims[axis] === 'number')
        root.style[axis] = axis === 'height' ? '100vh' : '100vw';
      else if (typeof dims[maximum] === 'number')
        root.style[maximum] = Math.max(0, dims[maximum]) + 'px';
    }
  }
  if (context.safeAreaInsets) {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const value = context.safeAreaInsets[side];
      root.style.setProperty(
        '--docket-safe-' + side,
        (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0) + 'px',
      );
    }
  }
};
`;
