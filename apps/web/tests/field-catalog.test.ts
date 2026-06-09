/**
 * Unit tests for the field-catalog model in
 * {@link import('../src/components/views/field-catalog')}.
 *
 * @remarks
 * The catalog is the typed declaration every list page hands to the unified filter toolbar +
 * engine. These tests pin the model helpers the toolbar relies on so a page can declare a field
 * once and trust the right operators, options, and labels appear:
 *
 * - each {@link FieldValueType} maps to its natural operator set (enum/relation as set membership,
 *   text as substring, date/number as comparison);
 * - the groupable / sortable / filterable partitions respect each field's flags (filterable
 *   defaults to on);
 * - option resolution prefers sync `options`, falls back to a lazy `resolveOptions`, else empty;
 * - value-label resolution prefers an explicit resolver, then an option label, then the raw value.
 */
import { describe, expect, it } from 'vitest';

import {
  type FieldCatalog,
  type FieldDescriptor,
  filterableFields,
  findField,
  groupableFields,
  labelForValue,
  operatorsForType,
  optionsFor,
  sortableFields,
} from '../src/components/views/field-catalog';

/** A row type for the fixtures. */
interface Row {
  status: string;
  leadId: string | null;
  name: string;
}

const catalog: FieldCatalog<Row> = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    accessor: (r) => r.status,
    options: [{ value: 'active', label: 'Active' }],
    groupable: true,
    sortable: true,
  },
  {
    key: 'leadId',
    label: 'Lead',
    type: 'relation',
    accessor: (r) => r.leadId,
    resolveOptions: () => [{ value: 'u1', label: 'Ada' }],
    groupable: true,
  },
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    accessor: (r) => r.name,
    sortable: true,
    filterable: false,
  },
];

describe('operatorsForType', () => {
  it('offers set-membership operators for enum and relation fields', () => {
    expect(operatorsForType('enum')).toEqual(['eq', 'neq', 'in', 'nin']);
    expect(operatorsForType('relation')).toEqual(['eq', 'neq', 'in', 'nin']);
  });

  it('offers substring for text and comparison for date/number', () => {
    expect(operatorsForType('text')).toEqual(['contains']);
    expect(operatorsForType('date')).toEqual(['eq', 'gt', 'lt']);
    expect(operatorsForType('number')).toEqual(['eq', 'neq', 'gt', 'lt']);
  });
});

describe('field partitions', () => {
  it('finds a field by key', () => {
    expect(findField(catalog, 'leadId')?.label).toBe('Lead');
    expect(findField(catalog, 'nope')).toBeUndefined();
  });

  it('partitions by groupable / sortable / filterable flags', () => {
    expect(groupableFields(catalog).map((f) => f.key)).toEqual(['status', 'leadId']);
    expect(sortableFields(catalog).map((f) => f.key)).toEqual(['status', 'name']);
    // `name` opts out of filtering; the others default to filterable.
    expect(filterableFields(catalog).map((f) => f.key)).toEqual(['status', 'leadId']);
  });
});

describe('optionsFor', () => {
  it('prefers sync options, falls back to a lazy resolver, else empty', () => {
    const statusField = findField(catalog, 'status')!;
    const leadField = findField(catalog, 'leadId')!;
    const nameField = findField(catalog, 'name')!;
    expect(optionsFor(statusField).map((o) => o.value)).toEqual(['active']);
    expect(optionsFor(leadField).map((o) => o.value)).toEqual(['u1']);
    expect(optionsFor(nameField)).toEqual([]);
  });
});

describe('labelForValue', () => {
  it('resolves through an explicit resolver, then an option label, then the raw value', () => {
    const statusField = findField(catalog, 'status')!;
    const leadField: FieldDescriptor<Row> = {
      ...findField(catalog, 'leadId')!,
      resolveLabel: (v) => (v === 'u1' ? 'Ada' : v),
    };
    expect(labelForValue(statusField, 'active')).toBe('Active');
    expect(labelForValue(statusField, 'mystery')).toBe('mystery');
    expect(labelForValue(leadField, 'u1')).toBe('Ada');
    expect(labelForValue(leadField, 'u9')).toBe('u9');
  });
});
