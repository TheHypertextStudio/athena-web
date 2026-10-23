import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { listLibraryResources } from '../content/library-discovery';
import { readLibraryContent, readLibraryResource } from '../content/library-reader';
import { NotFoundError } from '../error';
import type { SearchCaller } from '../search/query';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import {
  GetResourcesOutput,
  LibraryRef,
  ListResourcesInput,
  ListResourcesOutput,
} from '../contracts/library';
import { jsonRead } from './resource-statics';
import { jsonResult, runTool } from './result';
import { requireScope } from './scope';

function caller(ctx: McpContext): SearchCaller {
  requireScope(ctx.scopes, 'work:read');
  return ctx.principal.kind === 'user'
    ? { kind: 'user', userId: ctx.principal.userId }
    : { kind: 'agent', actorId: ctx.principal.agentActorId, organizationId: ctx.principal.orgId };
}

function libraryAddress(uri: URL): { ref: LibraryRef; content: boolean } {
  const [prefix, kind, id, suffix, ...extra] = uri.pathname.slice(1).split('/');
  if (
    uri.protocol !== 'docket:' ||
    prefix !== 'library' ||
    extra.length > 0 ||
    (suffix !== undefined && suffix !== 'content')
  )
    throw new NotFoundError();
  const parsed = LibraryRef.safeParse({
    orgId: uri.host,
    kind,
    id: id ? decodeURIComponent(id) : id,
  });
  if (!parsed.success) throw new NotFoundError();
  return { ref: parsed.data, content: suffix === 'content' };
}

/** Authorize subscription addresses through the same current Library reader used for retrieval. */
export async function authorizeLibraryUri(ctx: McpContext, uri: URL): Promise<void> {
  const identity = caller(ctx);
  const { ref, content } = libraryAddress(uri);
  const detail = await readLibraryResource(identity, ref);
  if (content && detail.content.status !== 'available') throw new NotFoundError();
}

/** Register permission-filtered Library discovery and batched current reads. */
export function registerLibraryTools(server: McpRegistrar, ctx: McpContext): void {
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    'list_resources',
    {
      title: 'List Library resources',
      description:
        'Browse or search Library links and attachments in one workspace or across the caller’s accessible workspaces.\n\nOmit orgId for all accessible workspaces. Registered agents remain workspace scoped. Blank query browses by recency; follow nextCursor even on empty pages. Indexing can lag; get_resources reads current details.',
      inputSchema: ListResourcesInput.shape,
      outputSchema: ListResourcesOutput.shape,
      annotations,
    },
    (input) => runTool(async () => jsonResult(await listLibraryResources(caller(ctx), input))),
  );
  server.registerTool(
    'get_resources',
    {
      title: 'Get Library resources',
      description:
        'Read current Library metadata, visible usage and uploaded-content availability for up to ten references.\n\nRefs name workspace, kind and id. Read uploaded bytes through the returned content URI. Linked sources expose saved metadata and URLs, not provider content. Missing and unreadable references both return not_found.',
      inputSchema: { refs: z.array(LibraryRef).min(1).max(10) },
      outputSchema: GetResourcesOutput.shape,
      annotations,
    },
    (input) =>
      runTool(async () => {
        const identity = caller(ctx);
        const items = [];
        for (const ref of input.refs) {
          try {
            items.push({
              ref,
              status: 'ok' as const,
              resource: await readLibraryResource(identity, ref),
            });
          } catch (error) {
            if (!(error instanceof NotFoundError)) throw error;
            items.push({ ref, status: 'not_found' as const });
          }
        }
        return jsonResult({ items });
      }),
  );
}

/** Register canonical detail and binary-content templates with the same readers as the tools. */
export function registerLibraryResources(server: McpRegistrar, ctx: McpContext): void {
  for (const content of [false, true]) {
    server.registerResource(
      content ? 'library-content' : 'library-detail',
      new ResourceTemplate(`docket://{org}/library/{kind}/{id}${content ? '/content' : ''}`, {
        list: undefined,
      }),
      {
        title: content ? 'Library file contents' : 'Library resource',
        description: content
          ? 'Read uploaded bytes after checking current access. Linked source contents are unsupported.'
          : 'Read current Library metadata, visible usage and content availability.',
        ...(content ? {} : { mimeType: 'application/json' }),
      },
      async (uri): Promise<ReadResourceResult> => {
        const identity = caller(ctx);
        const { ref } = libraryAddress(uri);
        if (!content) return jsonRead(uri, await readLibraryResource(identity, ref));
        const file = await readLibraryContent(identity, ref);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: file.mimeType,
              blob: Buffer.from(file.bytes).toString('base64'),
            },
          ],
        };
      },
    );
  }
}
