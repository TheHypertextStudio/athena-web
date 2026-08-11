import { describe, expect, it } from 'vitest';

import {
  mergeStreamSnapshot,
  revealStreamSnapshot,
  type StreamSnapshot,
} from '@/components/stream/stream-snapshot';
import type { StreamEventRow } from '@/components/stream/stream-meta';

function row(id: string): StreamEventRow {
  return {
    id,
    organizationId: 'org_1',
    system: 'docket',
    origin: 'docket',
    externalUrl: null,
    kind: 'status_change',
    occurredAt: `2026-06-29T${id.padStart(2, '0')}:00:00.000Z`,
    title: id,
    summary: null,
    permalink: null,
    actorSource: 'docket',
    actorExternalId: 'actor_1',
    actorDocketId: 'actor_1',
    actorName: 'Willie Chalmers III',
    actorAvatarUrl: null,
    actorIsViewer: true,
    entityKind: 'work_item',
    entityTitle: 'Ship the beta',
    entityExternalId: 'ENG-482',
    entityDocketId: 'task_482',
    entityUrl: null,
    relevance: null,
    rendering: { icon: 'status', category: 'progress' },
    detail: null,
  };
}

function ids(rows: readonly StreamEventRow[]): string[] {
  return rows.map((item) => item.id);
}

describe('mergeStreamSnapshot', () => {
  it('shows the initial response immediately', () => {
    const snapshot = mergeStreamSnapshot(null, [row('3'), row('2')], 'all');
    expect(ids(snapshot.visible)).toEqual(['3', '2']);
    expect(snapshot.pending).toEqual([]);
  });

  it('buffers a newly fetched prefix before the reader anchor', () => {
    const initial = mergeStreamSnapshot(null, [row('3'), row('2')], 'all');
    const next = mergeStreamSnapshot(initial, [row('5'), row('4'), row('3'), row('2')], 'all');
    expect(ids(next.visible)).toEqual(['3', '2']);
    expect(ids(next.pending)).toEqual(['5', '4']);
  });

  it('appends an older pagination suffix without moving the anchor', () => {
    const initial = mergeStreamSnapshot(null, [row('3'), row('2')], 'all');
    const next = mergeStreamSnapshot(initial, [row('3'), row('2'), row('1')], 'all');
    expect(ids(next.visible)).toEqual(['3', '2', '1']);
    expect(next.pending).toEqual([]);
  });

  it('does not duplicate a pending prefix on repeated polling', () => {
    const initial = mergeStreamSnapshot(null, [row('3'), row('2')], 'all');
    const pending = mergeStreamSnapshot(initial, [row('4'), row('3'), row('2')], 'all');
    const repeated = mergeStreamSnapshot(pending, [row('4'), row('3'), row('2')], 'all');
    expect(ids(repeated.pending)).toEqual(['4']);
  });

  it('resets immediately when the query identity changes', () => {
    const initial = mergeStreamSnapshot(null, [row('3'), row('2')], 'all');
    const pending = mergeStreamSnapshot(initial, [row('4'), row('3'), row('2')], 'all');
    const filtered = mergeStreamSnapshot(pending, [row('8')], 'filtered');
    expect(ids(filtered.visible)).toEqual(['8']);
    expect(filtered.pending).toEqual([]);
  });

  it('reveals the latest fetched order and clears pending activity', () => {
    const initial = mergeStreamSnapshot(null, [row('3'), row('2')], 'all');
    const pending = mergeStreamSnapshot(initial, [row('5'), row('4'), row('3'), row('2')], 'all');
    const revealed: StreamSnapshot = revealStreamSnapshot(pending);
    expect(ids(revealed.visible)).toEqual(['5', '4', '3', '2']);
    expect(revealed.pending).toEqual([]);
  });
});
