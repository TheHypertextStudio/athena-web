import { act, cleanup, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMentionExtension } from '@/components/mentions/mention-extension';
import { useMentionController } from '@/components/mentions/use-mention-controller';
import type { MentionItem } from '@/lib/contracts/mention';
import { installProseMirrorLayoutShims } from '../../editor/prosemirror-jsdom';

installProseMirrorLayoutShims();
const person: MentionItem = {
  origin: 'local',
  id: 'entity:actor:sam',
  entityKind: 'actor',
  ref: { kind: 'entity', entityKind: 'actor', entityId: 'sam' },
  title: 'Sam Rivera',
  subtitle: null,
  href: '/orgs/org/people/sam',
  score: 1,
};
const editors: Editor[] = [];
afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});
function setup() {
  const editor = new Editor({
    extensions: [
      StarterKit,
      createMentionExtension(() => () => ({ dom: document.createElement('span') })),
    ],
    content: '<p>Ask @Sam Rivera about the launch.</p>',
  });
  editors.push(editor);
  editor.commands.setTextSelection(16);
  const hook = renderHook(() => useMentionController({ orgId: 'org', enabled: true }));
  act(() => {
    hook.result.current.syncFromEditor(editor);
  });
  act(() => {
    hook.result.current.selectItem({
      origin: 'create-person',
      id: 'create-person',
      title: 'Add Sam',
      select: vi.fn(),
    });
  });
  return { editor, hook };
}

describe('rich editor person creation range', () => {
  it('inserts the person into the original range when the caret moves during creation', () => {
    const { editor, hook } = setup();
    editor.commands.setTextSelection(1);
    act(() => {
      hook.result.current.selectItem(person);
    });
    expect(editor.getText()).toBe('Ask   about the launch.');
    expect(editor.getJSON().content[0]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mention',
          attrs: expect.objectContaining({ entityId: 'sam', label: 'Sam Rivera' }),
        }),
      ]),
    );
  });
  it('does not throw or overwrite a document shortened while creation was pending', () => {
    const { editor, hook } = setup();
    editor.commands.setContent('<p>New draft.</p>');
    act(() => {
      hook.result.current.selectItem(person);
    });
    expect(editor.getText()).toBe('New draft.');
    expect(editor.getJSON().content[0]?.content).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'mention' })]),
    );
  });
});
