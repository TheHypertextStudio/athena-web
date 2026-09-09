/**
 * Recognize the configured consent UI and its exact return to the selected FedCM provider.
 * The UI may live on a different origin from the provider's same-origin continuation bridge.
 */
export function isProviderConsentUrl(
  url: URL,
  providerOrigin: string,
  consentOrigin: string,
): boolean {
  return (
    url.origin === consentOrigin &&
    url.pathname === '/consent' &&
    url.searchParams.get('return_to') === new URL('/web-identity/consent', providerOrigin).href
  );
}
