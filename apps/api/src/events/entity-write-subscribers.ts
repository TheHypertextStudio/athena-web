/**
 * The three things that currently happen when an entity is written.
 *
 * @remarks
 * Each is a small adapter around work that already existed, gathered here so the composition root
 * can see the whole list in one place. None of them knows about the others, and the seam that
 * publishes knows about none of them.
 */
import { enqueueSearchIndexJob } from '../search/enqueue';
import { notifyResourceUpdated } from '../mcp/notify';
import { entityUri } from '../mcp/resources';
import type { MentionReconciler } from '../content/reconcile-mentions';
import { wakeConfiguredNotionMirrors } from '../routes/notion-mirror-wake';

import type { EntityWriteSubscriber } from './entity-write-bus';
import { requestNotionMirrorSweep } from './notion-mirror-dispatch';

/** Project the written row into the search read model. */
export function searchIndexSubscriber(): EntityWriteSubscriber {
  return {
    name: 'search-index',
    handle: async (event) => {
      await enqueueSearchIndexJob({
        organizationId: event.organizationId,
        sourceTable: event.sourceTable,
        entityId: event.entityId,
        operation: event.operation,
        reason: 'entity_write',
      });
    },
  };
}

/**
 * Tell MCP sessions subscribed to this entity that it changed.
 *
 * @remarks
 * The URI is built by {@link entityUri} so the write path and the read path cannot disagree about
 * the scheme. An entity with no MCP URI is simply not announced.
 */
export function mcpNotifySubscriber(): EntityWriteSubscriber {
  return {
    name: 'mcp-notify',
    handle: async (event) => {
      const uri = entityUri(event.organizationId, event.sourceTable, event.entityId);
      // Null for a table with no MCP resource type; those are simply not announced.
      if (uri === null) return;
      await notifyResourceUpdated(uri);
    },
  };
}

/**
 * Re-derive the references written in the entity's prose.
 *
 * @param reconciler - Injected, so this subscriber depends on the reconciling *behavior* rather
 * than on a specific module reaching for a specific database.
 */
export function mentionReconcileSubscriber(reconciler: MentionReconciler): EntityWriteSubscriber {
  return {
    name: 'mention-reconcile',
    handle: async (event) => {
      if (event.operation === 'delete') {
        await reconciler.deleteForSubject(event.sourceTable, event.entityId);
        return;
      }
      await reconciler.reconcile(event.organizationId, event.sourceTable, event.entityId);
    },
  };
}

const NOTION_MIRROR_SOURCE_TABLES = new Set([
  'task',
  'project',
  'initiative',
  'program',
  'team',
  'cycle',
  'milestone',
  'label',
  'actor',
]);

/** Wake the Docket-designed Notion mirror after a projected entity changes. */
export function notionMirrorWakeSubscriber(
  wake: (organizationId: string) => Promise<number> = wakeConfiguredNotionMirrors,
  requestSweep: () => void = requestNotionMirrorSweep,
): EntityWriteSubscriber {
  return {
    name: 'notion-mirror-wake',
    handle: async (event) => {
      if (!NOTION_MIRROR_SOURCE_TABLES.has(event.sourceTable)) return;
      if ((await wake(event.organizationId)) > 0) requestSweep();
    },
  };
}
