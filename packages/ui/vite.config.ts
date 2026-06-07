import { docketVitest } from '../../tooling/vitest/preset';

export default docketVitest({
  environment: 'jsdom',
  react: true,
  setupFiles: ['./vitest.setup.ts'],
});
