/** Find the next radio option using the standard arrow, Home and End keys. */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  return null;
}

/** Focus a virtualized radio option after its state has been updated. */
export function focusRadio(group: HTMLDivElement | null, index: number): void {
  requestAnimationFrame(() => {
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  });
}
