/** Generated deployment bindings shared by authentication and the upstream protocol router. */
export type CacheEnv = Cloudflare.Env;

/** Request-scoped namespace derived exclusively from a verified Google identity. */
export interface CacheHonoEnv {
  Bindings: CacheEnv;
  Variables: { cacheTeam: string };
}
