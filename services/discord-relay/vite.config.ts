import { docketVitest } from '../../tooling/vitest/preset';

// `index.ts` is the Gateway WebSocket wiring — an IO boundary only exercised by really running
// against Discord, so it's excluded from coverage; the pure expansion + forwarding logic
// (`expand.ts`, `relay.ts`) is fully unit-tested.
export default docketVitest({ coverageExclude: ['src/index.ts'] });
