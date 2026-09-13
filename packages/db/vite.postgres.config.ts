import { docketVitest } from '../../tooling/vitest/preset';

export default docketVitest({
  include: ['tests/**/*.postgres.acceptance.ts'],
  fileParallelism: false,
  maxWorkers: 1,
  testTimeout: 180_000,
  hookTimeout: 180_000,
});
