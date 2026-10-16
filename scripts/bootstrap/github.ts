/**
 * Check that bootstrap writes every configuration name its doctor contract promises.
 * @param written The non-secret variables about to be saved.
 * @param promised Names required by the shared bootstrap and doctor contract.
 * @param constantName Name of that contract for a useful failure message.
 * @throws When a promised name is absent.
 */
export function assertWritesEveryName(
  written: Readonly<Record<string, string>>,
  promised: readonly string[],
  constantName: string,
): void {
  const missing = promised.filter((name) => !(name in written));
  if (missing.length > 0) {
    throw new Error(
      `${constantName} promises ${missing.join(', ')}, which bootstrap never writes.`,
    );
  }
}
