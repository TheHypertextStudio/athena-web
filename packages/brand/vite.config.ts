import { docketVitest } from '../../tooling/vitest/preset';

// The renderers are IO wrappers around the geometry; the geometry itself is the whole point of
// the package and is covered exhaustively. Coverage is measured over `mark.ts` alone so the
// number means "the layout math is tested" rather than "the file writers are mocked".
export default docketVitest({ coverageThreshold: 100, coverageInclude: ['src/mark.ts'] });
