import { describe, expect, it } from 'vitest';

import { dragActivationProfile } from '../../src/components/dnd/drag-context';
import { shouldPreventObjectDragActivation } from '../../src/components/dnd/object-pointer-sensor';

describe('drag activation profile', () => {
  it('uses a movement threshold for mouse and pen input', () => {
    expect(dragActivationProfile('mouse')).toEqual({ kind: 'distance', value: 6 });
    expect(dragActivationProfile('pen')).toEqual({ kind: 'distance', value: 6 });
  });

  it('uses a tolerant hold before touch association dragging', () => {
    expect(dragActivationProfile('touch')).toEqual({
      kind: 'delay',
      value: 250,
      tolerance: 8,
    });
  });

  it('reserves a stationary 450 ms touch hold for spatial association mode', () => {
    expect(dragActivationProfile('touch', true)).toEqual({
      kind: 'delay',
      value: 450,
      tolerance: 8,
    });
  });

  it('leaves buttons and links in charge of their pointer gestures', () => {
    const root = document.createElement('div');
    root.dataset['objectId'] = 'task-1';
    const button = document.createElement('button');
    const link = document.createElement('a');
    root.append(button, link);

    expect(
      shouldPreventObjectDragActivation({ target: button, pointerType: 'mouse', altKey: false }),
    ).toBe(true);
    expect(
      shouldPreventObjectDragActivation({ target: link, pointerType: 'pen', altKey: false }),
    ).toBe(true);
    expect(
      shouldPreventObjectDragActivation({ target: root, pointerType: 'mouse', altKey: false }),
    ).toBe(false);
  });

  it('requires Alt for mouse and pen association on spatial objects but not for touch holds', () => {
    const root = document.createElement('div');
    root.dataset['objectId'] = 'task-1';
    root.dataset['associationModifier'] = 'alt';

    expect(
      shouldPreventObjectDragActivation({ target: root, pointerType: 'mouse', altKey: false }),
    ).toBe(true);
    expect(
      shouldPreventObjectDragActivation({ target: root, pointerType: 'pen', altKey: true }),
    ).toBe(false);
    expect(
      shouldPreventObjectDragActivation({ target: root, pointerType: 'touch', altKey: false }),
    ).toBe(false);
  });
});
