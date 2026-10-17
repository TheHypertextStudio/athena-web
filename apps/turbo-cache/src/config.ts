/** Public cache configuration shared by native deployment and local workerd tests. */
export const cacheConfig = {
  accountId: '2500680a3b2b0fe6a011c1c25fed5008',
  workerName: 'studio-turbo-cache',
  domain: 'turbo-cache.hypertext.studio',
  bucketName: 'studio-turbo-cache',
  compatibilityDate: '2026-10-16',
  bindings: {
    OIDC_AUDIENCE: 'https://turbo-cache.hypertext.studio',
    OIDC_SUBJECT: '104950679521072783940',
    CACHE_TEAM: 'docket',
  },
} as const;
