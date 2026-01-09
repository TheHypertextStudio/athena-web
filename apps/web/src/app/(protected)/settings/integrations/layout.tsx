/**
 * Integrations settings layout with modal slot for route interception.
 *
 * This layout enables the parallel routes pattern where:
 * - Navigating from the list → shows detail in a modal (intercepted route)
 * - Direct link or refresh → shows full page (normal route)
 */

export default function IntegrationsLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
