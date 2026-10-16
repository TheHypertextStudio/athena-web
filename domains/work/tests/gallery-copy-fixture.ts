import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '../src/ids';
import { publication, ulid } from './blueprint-fixtures';
/** Real destination tenant identity for pure copy fixtures. */
export const destinationOrganizationId = OrganizationId.parse(ulid(800));
/** Checked inline Task base publication. */
export const base = publication(900, 'task');
/** Attach an exact source fingerprint. */
export const source = (snapshot: ReturnType<typeof publication>) => ({
  snapshot,
  fingerprint: `source:${snapshot.versionId}`,
});
/** Select one exact source publication. */
export const ref = (snapshot: ReturnType<typeof publication>) => ({
  workTypeId: snapshot.workTypeId,
  versionId: snapshot.versionId,
});
/** Supply independent caller-minted identities. */
export const destination = (snapshot: ReturnType<typeof publication>, n: number) => ({
  source: ref(snapshot),
  workTypeId: WorkTypeId.parse(ulid(n)),
  versionId: WorkTypeVersionId.parse(ulid(n + 100)),
});
