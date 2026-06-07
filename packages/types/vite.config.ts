import { docketVitest } from '../../tooling/vitest/preset';

// Trust spine: 100% coverage — a silent gap here is a security/data-integrity bug.
export default docketVitest({ coverageThreshold: 100 });
