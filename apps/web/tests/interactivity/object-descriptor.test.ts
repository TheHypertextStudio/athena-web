import { describe, expect, it } from 'vitest';

import {
  describeObject,
  isObjectKind,
  isSameObject,
  OBJECT_DESCRIPTORS,
  OBJECT_KINDS,
  OBJECT_PRESENTATION_POLICIES,
  type ObjectKind,
  type ObjectRef,
  objectKey,
  objectMetaString,
  objectTargetProps,
  parseObjectKey,
  readObjectTarget,
} from '../../src/lib/actions/object';

/**
 * The descriptor registry is the single place the interaction layer learns what a Docket object
 * is. If a kind is missing here it is silently un-draggable, un-selectable, and un-actionable
 * everywhere at once, so the enumeration itself is the thing worth pinning.
 */
describe('object descriptor registry', () => {
  it('enumerates every core data type exactly once', () => {
    const required: readonly ObjectKind[] = [
      'task',
      'project',
      'initiative',
      'initiative_root',
      'program',
      'cycle',
      'team',
      'milestone',
      'actor',
      'label',
      'calendar_event',
      'time_block',
      'calendar_slot',
    ];
    for (const kind of required) {
      expect(OBJECT_DESCRIPTORS[kind].kind).toBe(kind);
    }
    expect(new Set(OBJECT_KINDS).size).toBe(OBJECT_KINDS.length);
    expect(OBJECT_KINDS).toEqual(Object.keys(OBJECT_DESCRIPTORS));
  });

  it('describes each kind with the facts drag, menus and selection read', () => {
    for (const kind of OBJECT_KINDS) {
      const descriptor = describeObject(kind);
      expect(descriptor.noun.length).toBeGreaterThan(0);
      expect(descriptor.pluralNoun.length).toBeGreaterThan(0);
      expect(typeof descriptor.draggable).toBe('boolean');
      expect(typeof descriptor.selectable).toBe('boolean');
    }
  });

  it('assigns every interaction object an explicit presentation policy', () => {
    expect(Object.keys(OBJECT_PRESENTATION_POLICIES)).toEqual(OBJECT_KINDS);
    expect(OBJECT_PRESENTATION_POLICIES).toMatchObject({
      task: { policy: 'customizable', subjectType: 'task' },
      project: { policy: 'customizable', subjectType: 'project' },
      initiative: { policy: 'customizable', subjectType: 'initiative' },
      initiative_root: { policy: 'virtual' },
      program: { policy: 'customizable', subjectType: 'program' },
      cycle: { policy: 'customizable', subjectType: 'cycle' },
      team: { policy: 'customizable', subjectType: 'team' },
      milestone: { policy: 'customizable', subjectType: 'milestone' },
      actor: { policy: 'avatar' },
      label: { policy: 'semantic', subjectType: 'label' },
      calendar_event: { policy: 'external' },
      time_block: { policy: 'semantic' },
      calendar_slot: { policy: 'virtual' },
    });
  });

  it('rejects values that do not name a described kind', () => {
    expect(isObjectKind('task')).toBe(true);
    expect(isObjectKind('not_an_object')).toBe(false);
    expect(isObjectKind(42)).toBe(false);
    expect(isObjectKind(null)).toBe(false);
  });
});

describe('object keys', () => {
  it('keeps ids from different kinds apart', () => {
    // Nothing guarantees a task id never equals a project id, and a mixed list keyed on the bare
    // id would select the wrong row when they collide.
    const shared = '01KZ0R2DY0MNFG8BX4P297NQ9J';
    expect(objectKey({ kind: 'task', id: shared })).not.toBe(
      objectKey({ kind: 'project', id: shared }),
    );
  });

  it('round-trips through parseObjectKey', () => {
    expect(parseObjectKey(objectKey({ kind: 'time_block', id: 'tb_1' }))).toEqual({
      kind: 'time_block',
      id: 'tb_1',
    });
  });

  it('refuses malformed or unknown keys', () => {
    expect(parseObjectKey('task')).toBeNull();
    expect(parseObjectKey(':abc')).toBeNull();
    expect(parseObjectKey('task:')).toBeNull();
    expect(parseObjectKey('not_an_object:abc')).toBeNull();
  });

  it('compares objects by kind and id only', () => {
    const a: ObjectRef = { kind: 'task', id: 't1', organizationId: 'o1', title: 'Old title' };
    const b: ObjectRef = { kind: 'task', id: 't1', organizationId: 'o1', title: 'Renamed' };
    expect(isSameObject(a, b)).toBe(true);
    expect(isSameObject(a, { kind: 'project', id: 't1' })).toBe(false);
  });
});

describe('DOM object markings', () => {
  const task: ObjectRef = {
    kind: 'task',
    id: 't1',
    organizationId: 'org1',
    title: 'Draft the launch note',
    meta: { projectId: 'p1', done: false, position: 3 },
  };

  function markedElement(object: ObjectRef): HTMLElement {
    const element = document.createElement('div');
    for (const [name, value] of Object.entries(objectTargetProps(object))) {
      element.setAttribute(name, String(value));
    }
    return element;
  }

  it('round-trips an object through DOM attributes', () => {
    expect(readObjectTarget(markedElement(task))).toEqual(task);
  });

  it('omits the workspace attribute for a personal object rather than writing "null"', () => {
    const block: ObjectRef = {
      kind: 'time_block',
      id: 'tb1',
      organizationId: null,
      title: 'Deep work',
    };
    const props = objectTargetProps(block);
    expect(props).not.toHaveProperty('data-object-org');
    expect(readObjectTarget(markedElement(block))).toEqual(block);
  });

  it('reads null rather than throwing for unmarked, partial, or unknown elements', () => {
    // The only caller is a document-level handler; a throw there breaks the page over a stray
    // attribute, so every failure mode has to read as "not an object".
    expect(readObjectTarget(null)).toBeNull();
    expect(readObjectTarget(document.createElement('div'))).toBeNull();

    const partial = document.createElement('div');
    partial.setAttribute('data-object-kind', 'task');
    partial.setAttribute('data-object-id', 't1');
    expect(readObjectTarget(partial)).toBeNull();

    const unknownKind = markedElement(task);
    unknownKind.setAttribute('data-object-kind', 'not_an_object');
    expect(readObjectTarget(unknownKind)).toBeNull();
  });

  it('survives corrupted meta by dropping it instead of failing the read', () => {
    const element = markedElement(task);
    element.setAttribute('data-object-meta', '{not json');
    const read = readObjectTarget(element);
    expect(read).not.toBeNull();
    expect(read?.id).toBe('t1');
    expect(read?.meta).toBeUndefined();
  });

  it('reads typed meta values back', () => {
    expect(objectMetaString(task, 'projectId')).toBe('p1');
    expect(objectMetaString(task, 'done')).toBeNull();
    expect(objectMetaString(task, 'missing')).toBeNull();
  });
});
