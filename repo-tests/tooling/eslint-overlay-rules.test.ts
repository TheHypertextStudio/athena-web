/** Rule-level enforcement for shared UI ownership. */
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';

import plugin from '../../tooling/eslint-config/plugin.js';

// ESLint publishes `describe`/`it`/`itOnly` as assignable statics but omits `afterAll`, which
// the runtime does honor — RuleTester calls it to flush its unused-fixture check.
(RuleTester as unknown as { afterAll: typeof afterAll }).afterAll = afterAll;
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

describe('docket-ui/no-app-owned-columnheader export', () => {
  it('publishes the roster ownership rule through the shared plugin', () => {
    expect(plugin.rules['no-app-owned-columnheader']).toBeDefined();
  });
});

ruleTester.run('docket-ui/no-app-owned-columnheader', plugin.rules['no-app-owned-columnheader'], {
  valid: [
    { code: '<div role="status" />;' },
    { code: '<EntityTable {...props} />;' },
    {
      code: 'function GenericPassthrough(props) { return <div {...props} />; }',
      options: [{ allowPassthroughIn: ['GenericPassthrough'] }],
    },
    { code: "React.createElement('div', { role: 'row' });" },
    { code: 'React.createElement(EntityTable, props);' },
    {
      code: 'const GenericPassthrough = (props) => React.createElement("div", props);',
      options: [{ allowPassthroughIn: ['GenericPassthrough'] }],
    },
  ],
  invalid: [
    {
      code: '<div role="columnheader" />;',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'const role = "columnheader"; <div role={role} />;',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'function Header({ role }) { return <div role={role} />; }',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: '<div role={`columnheader`} />;',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: '<div {...{ role: "columnheader" }} />;',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'const props = { role: "columnheader" }; <div {...props} />;',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'function Surface(props) { return <div {...props} />; }',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'import props from "./props"; <div {...props} />;',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: '<div {...getProps()} />;',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'React.createElement("div", { role: "columnheader" });',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'const role = "columnheader"; createElement("div", { role });',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'function Surface(props) { return React.createElement("div", props); }',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'import props from "./props"; React.createElement("div", props);',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'React.createElement("div", getProps());',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'function Surface(props) { return createElement("div", props); }',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'import props from "./props"; createElement("div", props);',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'createElement("div", getProps());',
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'function GenericPassthrough(props) { return <div role="columnheader" {...props} />; }',
      options: [{ allowPassthroughIn: ['GenericPassthrough'] }],
      errors: [{ messageId: 'useEntityTable' }],
    },
    {
      code: 'function OtherSurface(props) { return <div {...props} />; }',
      options: [{ allowPassthroughIn: ['GenericPassthrough'] }],
      errors: [{ messageId: 'useEntityTable' }],
    },
  ],
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

ruleTester.run('docket-ui/no-server-query-import', plugin.rules['no-server-query-import'], {
  valid: [
    { code: "'use client'; import { useApiQuery } from '@/lib/query'; useApiQuery;" },
    { code: "import { query } from '@/lib/query-server'; query;" },
  ],
  invalid: [
    {
      code: "import { useApiQuery } from '@/lib/query'; useApiQuery;",
      errors: [{ messageId: 'useServerQuery' }],
    },
  ],
});
