import { describe, expect, it } from 'vitest';

import { serializeDocumentFigure } from '@docket/markdown-tree';

import {
  DOCUMENT_IMAGE_FIELDS,
  createDocumentImageReferenceReconciler,
  type DocumentImageReferenceDraft,
  type DocumentImageReferenceStorage,
  type DocumentImageSubject,
  type DocumentImageSubjectRow,
  type DocumentImageSubjectType,
} from '../../src/content/document-image-references';

const subjectTypes = [
  'task',
  'project',
  'program',
  'initiative',
  'team',
  'milestone',
  'comment',
  'update',
  'template',
] as const satisfies readonly DocumentImageSubjectType[];

function figure(imageId: string, orgId = 'org_1'): string {
  return serializeDocumentFigure({
    version: 1,
    src: `/v1/orgs/${orgId}/images/${imageId}`,
    alt: 'A figure',
    decorative: false,
  });
}

interface FakeState {
  readonly rows: Map<string, DocumentImageSubjectRow>;
  readonly references: Map<string, readonly DocumentImageReferenceDraft[]>;
  readonly deletes: string[];
  authoritativeReads: number;
}

function subjectKey(subject: Pick<DocumentImageSubject, 'subjectType' | 'subjectId'>): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

function fakeStorage(input?: {
  rows?: ReadonlyMap<string, DocumentImageSubjectRow>;
  ownedImageIds?: ReadonlySet<string>;
  projectedImageIds?: ReadonlySet<string>;
}): { storage: DocumentImageReferenceStorage; state: FakeState } {
  const state: FakeState = {
    rows: new Map(input?.rows),
    references: new Map(),
    deletes: [],
    authoritativeReads: 0,
  };
  const storage: DocumentImageReferenceStorage = {
    references: {
      replaceForSubject: (subject, desired) => {
        state.references.set(subjectKey(subject), desired);
        return Promise.resolve();
      },
      deleteForSubject: (_organizationId, subjectType, subjectId) => {
        state.deletes.push(`${subjectType}:${subjectId}`);
        return Promise.resolve();
      },
      hasImageReference: (_organizationId, imageId) =>
        Promise.resolve(input?.projectedImageIds?.has(imageId) ?? false),
    },
    images: {
      filterOwnedImageIds: (_organizationId, imageIds) =>
        Promise.resolve(
          new Set(imageIds.filter((imageId) => input?.ownedImageIds?.has(imageId) ?? true)),
        ),
    },
    subjects: {
      read: (subjectType, subjectId) =>
        Promise.resolve(state.rows.get(`${subjectType}:${subjectId}`)),
      listAll: () => {
        state.authoritativeReads += 1;
        return Promise.resolve([...state.rows.values()]);
      },
    },
  };
  return { storage, state };
}

describe('document image reference reconciliation', () => {
  it('declares all nine saved prose subjects and their Markdown field', () => {
    expect(DOCUMENT_IMAGE_FIELDS).toEqual({
      task: ['description'],
      project: ['description'],
      program: ['description'],
      initiative: ['description'],
      team: ['description'],
      milestone: ['description'],
      comment: ['body'],
      update: ['body'],
      template: ['description'],
    });
  });

  it.each(subjectTypes)('reconciles owned figures for %s prose', async (subjectType) => {
    const field = DOCUMENT_IMAGE_FIELDS[subjectType][0];
    const row: DocumentImageSubjectRow = {
      organizationId: 'org_1',
      subjectType,
      subjectId: 'subject_1',
      prose: { [field]: figure('image_1') },
    };
    const { storage, state } = fakeStorage({ rows: new Map([[subjectKey(row), row]]) });

    await createDocumentImageReferenceReconciler(storage).reconcile(
      'org_1',
      subjectType,
      'subject_1',
    );

    expect(state.references.get(`${subjectType}:subject_1`)).toEqual([
      { imageId: 'image_1', field, position: 0 },
    ]);
  });

  it('replaces the complete projection when an image changes', async () => {
    const row: DocumentImageSubjectRow = {
      organizationId: 'org_1',
      subjectType: 'project',
      subjectId: 'project_1',
      prose: { description: `${figure('image_1')}\n\n${figure('image_2')}` },
    };
    const { storage, state } = fakeStorage({ rows: new Map([[subjectKey(row), row]]) });
    const reconciler = createDocumentImageReferenceReconciler(storage);

    await reconciler.reconcile('org_1', 'project', 'project_1');
    state.rows.set('project:project_1', {
      ...row,
      prose: { description: figure('image_2') },
    });
    await reconciler.reconcile('org_1', 'project', 'project_1');

    expect(state.references.get('project:project_1')).toEqual([
      { imageId: 'image_2', field: 'description', position: 0 },
    ]);
  });

  it('does not project an image owned by another workspace', async () => {
    const row: DocumentImageSubjectRow = {
      organizationId: 'org_1',
      subjectType: 'task',
      subjectId: 'task_1',
      prose: { description: figure('foreign_image', 'org_2') },
    };
    const { storage, state } = fakeStorage({
      rows: new Map([[subjectKey(row), row]]),
      ownedImageIds: new Set(),
    });

    await createDocumentImageReferenceReconciler(storage).reconcile('org_1', 'task', 'task_1');

    expect(state.references.get('task:task_1')).toEqual([]);
  });

  it('deletes the projection when the subject no longer exists', async () => {
    const { storage, state } = fakeStorage();

    await createDocumentImageReferenceReconciler(storage).reconcile('org_1', 'task', 'gone');

    expect(state.deletes).toEqual(['task:gone']);
  });

  it('removes references for a deleted saved subject', async () => {
    const { storage, state } = fakeStorage();

    await createDocumentImageReferenceReconciler(storage).deleteForSubject(
      'org_1',
      'project',
      'project_1',
    );

    expect(state.deletes).toEqual(['project:project_1']);
  });

  it('uses a present projection without scanning every authoritative row', async () => {
    const { storage, state } = fakeStorage({ projectedImageIds: new Set(['image_1']) });

    await expect(
      createDocumentImageReferenceReconciler(storage).isImageInUse('org_1', 'image_1'),
    ).resolves.toBe(true);
    expect(state.authoritativeReads).toBe(0);
  });

  it('repairs a missing projection when authoritative prose still references the image', async () => {
    const row: DocumentImageSubjectRow = {
      organizationId: 'org_1',
      subjectType: 'template',
      subjectId: 'template_1',
      prose: { description: figure('image_1') },
    };
    const { storage, state } = fakeStorage({ rows: new Map([[subjectKey(row), row]]) });

    await expect(
      createDocumentImageReferenceReconciler(storage).isImageInUse('org_1', 'image_1'),
    ).resolves.toBe(true);
    expect(state.authoritativeReads).toBe(1);
    expect(state.references.get('template:template_1')).toEqual([
      { imageId: 'image_1', field: 'description', position: 0 },
    ]);
  });

  it('returns false only after authoritative prose confirms the image is unused', async () => {
    const { storage, state } = fakeStorage();

    await expect(
      createDocumentImageReferenceReconciler(storage).isImageInUse('org_1', 'image_1'),
    ).resolves.toBe(false);
    expect(state.authoritativeReads).toBe(1);
  });
});
