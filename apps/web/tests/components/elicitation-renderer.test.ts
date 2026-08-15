/**
 * The schema-driven renderer's pure half: empty values, DOM coercion, and readiness.
 *
 * @remarks
 * These three functions decide whether the submit control is live and what leaves the browser, so
 * they are where a form silently sends the wrong shape. Kept out of a DOM test on purpose — the
 * behaviour is total over the control grammar, and asserting it as data covers every kind rather
 * than the two a rendering test would reach.
 */
import { ElicitationControlSchema, type ElicitationControl } from '@docket/athena/elicitation';
import { describe, expect, it } from 'vitest';

import {
  coerceElicitationValue,
  emptyElicitationValue,
  isElicitationAnswered,
} from '../../src/components/athena/elicitation-control';

const TEXT: ElicitationControl = {
  kind: 'text',
  multiline: false,
  minLength: null,
  maxLength: null,
  placeholder: null,
};
const NUMBER: ElicitationControl = { kind: 'number', integer: true, min: 1, max: 10 };
const CONFIRM: ElicitationControl = { kind: 'confirm', confirmLabel: 'Yes', declineLabel: 'No' };
const SELECT: ElicitationControl = {
  kind: 'select',
  multiple: false,
  options: [{ value: 'a', label: 'A', description: null }],
};
const DATETIME: ElicitationControl = {
  kind: 'datetime',
  precision: 'date',
  timeZone: 'UTC',
  min: null,
  max: null,
};
const FILE: ElicitationControl = { kind: 'file', accept: [], maxBytes: 100, multiple: false };

describe('Athena elicitation contract', () => {
  it('parses the renderer control grammar from the Athena domain', () => {
    expect(ElicitationControlSchema.parse(TEXT)).toEqual(TEXT);
  });
});

describe('empty values', () => {
  it('starts every control kind in a coherent state', () => {
    expect(emptyElicitationValue(TEXT)).toBe('');
    expect(emptyElicitationValue(NUMBER)).toBe('');
    expect(emptyElicitationValue(CONFIRM)).toBeNull();
    expect(emptyElicitationValue(SELECT)).toBeNull();
    expect(emptyElicitationValue({ ...SELECT, multiple: true })).toEqual([]);
    expect(emptyElicitationValue(DATETIME)).toBe('');
    expect(emptyElicitationValue(FILE)).toBeNull();
    expect(
      emptyElicitationValue({ kind: 'list', item: TEXT, minItems: null, maxItems: null }),
    ).toEqual([]);
    expect(
      emptyElicitationValue({
        kind: 'form',
        fields: [{ key: 'a', label: 'A', description: null, required: true, control: TEXT }],
      }),
    ).toEqual({ a: '' });
  });

  it('preselects a variant’s first arm so the form is never in an impossible state', () => {
    expect(
      emptyElicitationValue({
        kind: 'variant',
        discriminator: 'kind',
        variants: [
          {
            value: 'email',
            label: 'Email',
            fields: [{ key: 'to', label: 'To', description: null, required: true, control: TEXT }],
          },
          { value: 'slack', label: 'Slack', fields: [] },
        ],
      }),
    ).toEqual({ kind: 'email', to: '' });
  });
});

describe('coercion', () => {
  it('turns the DOM’s numeric string into a number and a blank into null', () => {
    expect(coerceElicitationValue(NUMBER, '7')).toBe(7);
    expect(coerceElicitationValue(NUMBER, '')).toBeNull();
    // Left as-is when it is not a number at all, so the server reports the real problem.
    expect(coerceElicitationValue(NUMBER, 'seven')).toBe('seven');
  });

  it('drops blank optional fields rather than submitting empty strings for them', () => {
    const form: ElicitationControl = {
      kind: 'form',
      fields: [
        { key: 'title', label: 'Title', description: null, required: true, control: TEXT },
        { key: 'note', label: 'Note', description: null, required: false, control: TEXT },
        { key: 'count', label: 'Count', description: null, required: false, control: NUMBER },
      ],
    };

    expect(coerceElicitationValue(form, { title: 'Ship it', note: '', count: '' })).toEqual({
      title: 'Ship it',
    });
  });

  it('keeps only the selected arm’s fields for a variant', () => {
    const variant: ElicitationControl = {
      kind: 'variant',
      discriminator: 'kind',
      variants: [
        {
          value: 'email',
          label: 'Email',
          fields: [{ key: 'to', label: 'To', description: null, required: true, control: TEXT }],
        },
        {
          value: 'slack',
          label: 'Slack',
          fields: [
            { key: 'channel', label: 'Channel', description: null, required: true, control: TEXT },
          ],
        },
      ],
    };

    expect(
      coerceElicitationValue(variant, { kind: 'slack', channel: '#acme', to: 'stale' }),
    ).toEqual({
      kind: 'slack',
      channel: '#acme',
    });
  });

  it('coerces every item of a list', () => {
    expect(
      coerceElicitationValue({ kind: 'list', item: NUMBER, minItems: null, maxItems: null }, [
        '1',
        '2',
      ]),
    ).toEqual([1, 2]);
  });
});

describe('readiness', () => {
  it('keeps submit disabled until a required answer exists', () => {
    expect(isElicitationAnswered(CONFIRM, null)).toBe(false);
    expect(isElicitationAnswered(CONFIRM, false)).toBe(true);
    expect(isElicitationAnswered(SELECT, null)).toBe(false);
    expect(isElicitationAnswered(SELECT, 'a')).toBe(true);
    expect(isElicitationAnswered({ ...SELECT, multiple: true }, [])).toBe(false);
    expect(isElicitationAnswered(TEXT, '   ')).toBe(false);
    expect(isElicitationAnswered(TEXT, 'hello')).toBe(true);
    // A date is not submittable until it parses, which is what the picker's own state enforces.
    expect(isElicitationAnswered(DATETIME, '')).toBe(false);
    expect(isElicitationAnswered(DATETIME, '2026-08-05')).toBe(true);
    expect(isElicitationAnswered(FILE, null)).toBe(false);
    expect(isElicitationAnswered(FILE, { attachmentId: 'a' })).toBe(true);
  });

  it('ignores optional fields when deciding a form is ready', () => {
    const form: ElicitationControl = {
      kind: 'form',
      fields: [
        { key: 'title', label: 'Title', description: null, required: true, control: TEXT },
        { key: 'note', label: 'Note', description: null, required: false, control: TEXT },
      ],
    };

    expect(isElicitationAnswered(form, { title: '', note: 'x' })).toBe(false);
    expect(isElicitationAnswered(form, { title: 'Ship it', note: '' })).toBe(true);
  });

  it('requires the selected variant arm’s own fields', () => {
    const variant: ElicitationControl = {
      kind: 'variant',
      discriminator: 'kind',
      variants: [
        {
          value: 'email',
          label: 'Email',
          fields: [{ key: 'to', label: 'To', description: null, required: true, control: TEXT }],
        },
      ],
    };

    expect(isElicitationAnswered(variant, { kind: 'email', to: '' })).toBe(false);
    expect(isElicitationAnswered(variant, { kind: 'email', to: 'ada@example.com' })).toBe(true);
    expect(isElicitationAnswered(variant, { kind: 'carrier-pigeon' })).toBe(false);
  });
});
