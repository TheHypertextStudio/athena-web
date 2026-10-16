/** Cross a layout/document boundary while preserving the full URL and native draft-unload protection. */
export function navigateDocument(href: string, replace = false): void {
  if (replace) window.location.replace(href);
  else window.location.assign(href);
}
