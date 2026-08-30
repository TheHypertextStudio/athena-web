/** Rule-level enforcement for shared UI ownership. */
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';

import plugin from '../../tooling/eslint-config/plugin.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
      projectService: false,
    },
  },
});

ruleTester.run('docket-ui/no-bespoke-overlay', plugin.rules['no-bespoke-overlay'], {
  valid: [
    { code: "import { DialogContent } from '@docket/ui/primitives'; <DialogContent />;" },
    { code: '<div role="status" />;' },
  ],
  invalid: [
    {
      code: '<div role="dialog" aria-modal="true" className="fixed inset-0" />;',
      errors: [{ messageId: 'usePresentation' }],
    },
    {
      code: '<ul role="menu"><li role="menuitem">Archive</li></ul>;',
      errors: [{ messageId: 'usePresentation' }, { messageId: 'usePresentation' }],
    },
    {
      code: '<div {...{ role: "alertdialog", "aria-modal": true }} />;',
      errors: [{ messageId: 'usePresentation' }],
    },
  ],
});

ruleTester.run('docket-ui/no-overlay-style-override', plugin.rules['no-overlay-style-override'], {
  valid: [
    {
      code: "import { DialogContent } from '@docket/ui/primitives'; <DialogContent presentation={{ kind: 'centered', size: 'wide' }} />;",
    },
    { code: 'const DialogContent = () => <div />; <DialogContent className="grid gap-3" />;' },
    {
      code: 'import { DialogHeader } from \'@docket/ui/primitives\'; <DialogHeader className="border-outline-variant border-b" />;',
    },
  ],
  invalid: [
    {
      code: 'import { DialogContent as Pane } from \'@docket/ui/primitives\'; <Pane className="fixed max-w-4xl bg-surface p-8 shadow-xl" />;',
      errors: [{ messageId: 'usePresentation' }],
    },
    {
      code: "import * as UI from '@docket/ui/primitives'; <UI.PopoverBody className={cn('overflow-auto', active && 'px-4')} />;",
      errors: [{ messageId: 'useSection' }],
    },
    {
      code: "import { SheetContent } from '../../primitives'; <SheetContent style={{ maxHeight: 400, borderRadius: 12 }} />;",
      errors: [{ messageId: 'usePresentation' }],
    },
    {
      code: 'import { SheetBody } from \'@docket/ui/primitives\'; <SheetBody className="p-5" />;',
      errors: [{ messageId: 'useSection' }],
    },
  ],
});

ruleTester.run('docket-ui/no-raw-surface-role', plugin.rules['no-raw-surface-role'], {
  valid: [
    { code: '<button className="hover:bg-surface-container-high">Open</button>;' },
    { code: '<Surface tone="floating" />;' },
  ],
  invalid: [
    {
      code: "<section className={cn('bg-surface-container-high', active && 'opacity-100')} />;",
      errors: [{ messageId: 'useSurface' }],
    },
    {
      code: '<div className={`bg-surface`} />;',
      errors: [{ messageId: 'useSurface' }],
    },
    {
      code: '<div style={{ background: "var(--color-surface-container)" }} />;',
      errors: [{ messageId: 'useSurface' }],
    },
  ],
});
