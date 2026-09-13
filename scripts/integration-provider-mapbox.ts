import type { ProviderGroup } from './integration-providers';

/** Mapbox Geocoding setup metadata and operator instructions. */
export const MAPBOX_PROVIDER_GROUP: ProviderGroup = {
  id: 'mapbox',
  title: 'Mapbox Geocoding Set-up',
  label: 'Mapbox Geocoding',
  consoleUrl: 'https://account.mapbox.com/access-tokens/',
  vars: ['MAPBOX_ACCESS_TOKEN'],
  instructions: () => [
    'Docket uses Mapbox Geocoding for saved-place address search and reverse geocoding.',
    'The API keeps the token on the server and resolves stored results with permanent=true.',
    '',
    '1) Open https://account.mapbox.com/access-tokens/ in the Hypertext Studio account.',
    '2) Confirm that the account has billing or an enterprise agreement that permits permanent',
    '   geocoding results before production use.',
    '3) Create a restricted token that can call the Mapbox Geocoding API.',
    '4) Enter the token as MAPBOX_ACCESS_TOKEN. The wizard stores it in Secret Manager and',
    '   binds it to the API service. Do not put the token in a browser environment variable.',
  ],
};
