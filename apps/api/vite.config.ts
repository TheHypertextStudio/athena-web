import { docketVitest } from '../../tooling/vitest/preset';
import { API_TEST_ENV } from './tests/support/env';

export default docketVitest({ env: API_TEST_ENV });
