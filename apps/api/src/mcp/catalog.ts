/**
 * `@docket/api` -- catalog-backed MCP registration.
 */
import type {
  McpServer,
  PromptCallback,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  RegisteredPrompt,
  RegisteredResource,
  RegisteredResourceTemplate,
  RegisteredTool,
  ResourceMetadata,
  ResourceTemplate,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  TaskToolExecution,
  ToolTaskHandler,
} from '@modelcontextprotocol/sdk/experimental/tasks';
import {
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { db, mcpSubscription } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError } from '../error';
import type { McpContext } from './auth';
import { authorizeResourceUri } from './resources';
import { setSessionLogLevel } from './session-registry';
import {
  type PromptConfig,
  type PromptListValue,
  type ResourceListValue,
  type ResourceTemplateListValue,
  type ToolConfig,
  type ToolInputSchema,
  type ToolListValue,
  type ToolOutputSchema,
  promptListValue,
  toolListValue,
} from './list-metadata';
import { type CatalogEntry, pageValues } from './list-pagination';

const DEFAULT_PAGE_SIZE = 50;

/** Read the stable or legacy UI resource linkage from a tool's open metadata map. */
function uiToolResourceUri(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const record = meta as Readonly<Record<PropertyKey, unknown>>;
  for (const key of ['ui', 'io.modelcontextprotocol/ui']) {
    const value = record[key];
    if (typeof value === 'string' && value.startsWith('ui://')) return value;
    if (value && typeof value === 'object') {
      const resourceUri = (value as Readonly<Record<PropertyKey, unknown>>)['resourceUri'];
      if (typeof resourceUri === 'string' && resourceUri.startsWith('ui://')) return resourceUri;
    }
  }
  return null;
}

/**
 * Guarantee a useful non-UI representation for an Athena tool that also declares a widget.
 *
 * @remarks
 * The enforcement lives at the server registration boundary so a future UI-enabled handler cannot
 * accidentally return only structured data. Non-UI clients ignore widget metadata and depend on
 * this content; structured output is serialized when available, otherwise the result still names
 * whether the operation completed or failed.
 */
function ensureUiToolTextFallback(result: CallToolResult): CallToolResult {
  if (
    result.content.some(
      (block) =>
        block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '',
    )
  ) {
    return result;
  }
  const text = result.structuredContent
    ? JSON.stringify(result.structuredContent, null, 2)
    : result.isError
      ? 'The tool could not complete.'
      : 'The tool completed successfully.';
  return { ...result, content: [...result.content, { type: 'text', text }] };
}

/** Wrap a UI-enabled tool callback with the server's text-fallback invariant. */
function uiToolCallback<InputArgs extends ToolInputSchema>(
  config: ToolConfig<InputArgs, ToolOutputSchema>,
  callback: ToolCallback<InputArgs>,
): ToolCallback<InputArgs> {
  if (!uiToolResourceUri(config._meta)) return callback;
  const invoke = callback as (
    ...args: Parameters<ToolCallback<InputArgs>>
  ) => CallToolResult | Promise<CallToolResult>;
  return (async (...args: Parameters<ToolCallback<InputArgs>>) =>
    ensureUiToolTextFallback(await invoke(...args))) as ToolCallback<InputArgs>;
}

type ListResourcesRequest = z.infer<typeof ListResourcesRequestSchema>;
type ListResourceTemplatesRequest = z.infer<typeof ListResourceTemplatesRequestSchema>;
type ListPromptsRequest = z.infer<typeof ListPromptsRequestSchema>;
type ListToolsRequest = z.infer<typeof ListToolsRequestSchema>;

interface CatalogOptions {
  readonly pageSize?: number;
  readonly tasksEnabled?: boolean;
}

type TaskToolConfig<InputArgs extends ToolInputSchema, OutputArgs extends ToolOutputSchema> = Omit<
  ToolConfig<InputArgs, OutputArgs>,
  'execution'
> & {
  readonly execution: TaskToolExecution<'optional' | 'required'>;
};

type StaticResourceArgs = [
  name: string,
  uri: string,
  config: ResourceMetadata,
  readCallback: ReadResourceCallback,
];

type TemplateResourceArgs = [
  name: string,
  template: ResourceTemplate,
  config: ResourceMetadata,
  readCallback: ReadResourceTemplateCallback,
];

function isStaticResourceArgs(
  args: StaticResourceArgs | TemplateResourceArgs,
): args is StaticResourceArgs {
  return typeof args[1] === 'string';
}

/** The registration surface used by Docket's MCP modules. */
export interface McpRegistrar {
  registerTool<OutputArgs extends ToolOutputSchema, InputArgs extends ToolInputSchema = undefined>(
    name: string,
    config: ToolConfig<InputArgs, OutputArgs>,
    cb: ToolCallback<InputArgs>,
  ): RegisteredTool;

  registerResource(
    name: string,
    uri: string,
    config: ResourceMetadata,
    readCallback: ReadResourceCallback,
  ): RegisteredResource;
  registerResource(
    name: string,
    template: ResourceTemplate,
    config: ResourceMetadata,
    readCallback: ReadResourceTemplateCallback,
  ): RegisteredResourceTemplate;

  registerPrompt<Args extends z.ZodRawShape>(
    name: string,
    config: PromptConfig<Args>,
    cb: PromptCallback<Args>,
  ): RegisteredPrompt;
}

/** Catalog wrapper for an SDK MCP server. */
export class McpCatalog implements McpRegistrar {
  readonly tasksEnabled: boolean;
  private readonly pageSize: number;
  private readonly protocol: McpServer['server'];
  private readonly tools: CatalogEntry<ToolListValue>[] = [];
  private readonly resources: CatalogEntry<ResourceListValue>[] = [];
  private readonly resourceTemplates: CatalogEntry<ResourceTemplateListValue>[] = [];
  private readonly prompts: CatalogEntry<PromptListValue>[] = [];

  constructor(
    private readonly mcp: McpServer,
    options: CatalogOptions = {},
  ) {
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.tasksEnabled = options.tasksEnabled ?? false;
    this.protocol = mcp.server;
  }

  registerTool<OutputArgs extends ToolOutputSchema, InputArgs extends ToolInputSchema = undefined>(
    name: string,
    config: ToolConfig<InputArgs, OutputArgs>,
    cb: ToolCallback<InputArgs>,
  ): RegisteredTool {
    this.tools.push({ key: name, value: toolListValue(name, config) });
    return this.mcp.registerTool(name, config, uiToolCallback(config, cb));
  }

  registerTaskTool<
    OutputArgs extends ToolOutputSchema,
    InputArgs extends ToolInputSchema = undefined,
  >(
    name: string,
    config: TaskToolConfig<InputArgs, OutputArgs>,
    handler: ToolTaskHandler<InputArgs>,
    fallback: ToolCallback<InputArgs>,
  ): RegisteredTool {
    if (!this.tasksEnabled) {
      const syncConfig: ToolConfig<InputArgs, OutputArgs> = {
        ...config,
        execution: { taskSupport: 'forbidden' },
      };
      this.tools.push({ key: name, value: toolListValue(name, syncConfig) });
      return this.mcp.registerTool(name, syncConfig, uiToolCallback(syncConfig, fallback));
    }

    this.tools.push({ key: name, value: toolListValue(name, config) });
    return this.mcp.experimental.tasks.registerToolTask(
      name,
      config as Parameters<typeof this.mcp.experimental.tasks.registerToolTask>[1],
      handler as Parameters<typeof this.mcp.experimental.tasks.registerToolTask>[2],
    );
  }

  registerResource(
    name: string,
    uri: string,
    config: ResourceMetadata,
    readCallback: ReadResourceCallback,
  ): RegisteredResource;
  registerResource(
    name: string,
    template: ResourceTemplate,
    config: ResourceMetadata,
    readCallback: ReadResourceTemplateCallback,
  ): RegisteredResourceTemplate;
  registerResource(
    ...args: StaticResourceArgs | TemplateResourceArgs
  ): RegisteredResource | RegisteredResourceTemplate {
    if (isStaticResourceArgs(args)) {
      const [name, uri, config, readCallback] = args;
      this.resources.push({ key: uri, value: { uri, name, ...config } });
      return this.mcp.registerResource(name, uri, config, readCallback);
    }

    const [name, template, config, readCallback] = args;
    const uriTemplate = template.uriTemplate.toString();
    this.resourceTemplates.push({ key: uriTemplate, value: { uriTemplate, name, ...config } });
    return this.mcp.registerResource(name, template, config, readCallback);
  }

  registerPrompt<Args extends z.ZodRawShape>(
    name: string,
    config: PromptConfig<Args>,
    cb: PromptCallback<Args>,
  ): RegisteredPrompt {
    this.prompts.push({ key: name, value: promptListValue(name, config) });
    return this.mcp.registerPrompt(name, config, cb);
  }

  installListHandlers(ctx: McpContext): void {
    const sortedTools = [...this.tools].sort((a, b) => a.key.localeCompare(b.key));
    const sortedResources = [...this.resources].sort((a, b) => a.key.localeCompare(b.key));
    const sortedTemplates = [...this.resourceTemplates].sort((a, b) => a.key.localeCompare(b.key));
    const sortedPrompts = [...this.prompts].sort((a, b) => a.key.localeCompare(b.key));

    this.protocol.setRequestHandler(ListToolsRequestSchema, (request: ListToolsRequest) => {
      const page = pageValues(sortedTools, request.params?.cursor, 'tools', ctx, this.pageSize);
      return { tools: page.items, nextCursor: page.nextCursor };
    });

    this.protocol.setRequestHandler(ListResourcesRequestSchema, (request: ListResourcesRequest) => {
      const page = pageValues(
        sortedResources,
        request.params?.cursor,
        'resources',
        ctx,
        this.pageSize,
      );
      return { resources: page.items, nextCursor: page.nextCursor };
    });

    this.protocol.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      (request: ListResourceTemplatesRequest) => {
        const page = pageValues(
          sortedTemplates,
          request.params?.cursor,
          'resourceTemplates',
          ctx,
          this.pageSize,
        );
        return { resourceTemplates: page.items, nextCursor: page.nextCursor };
      },
    );

    this.protocol.setRequestHandler(ListPromptsRequestSchema, (request: ListPromptsRequest) => {
      const page = pageValues(sortedPrompts, request.params?.cursor, 'prompts', ctx, this.pageSize);
      return { prompts: page.items, nextCursor: page.nextCursor };
    });
  }

  /**
   * Install `resources/subscribe`, `resources/unsubscribe`, and `logging/setLevel`.
   *
   * @remarks
   * The SDK ships schemas for all three but registers handlers for none, so they are ours. They
   * live here rather than in `resources.ts` because, like the list handlers, they are protocol
   * plumbing over the whole catalog rather than behavior of any one resource.
   *
   * Subscribing authorizes the URI through exactly the same path a read does, so it can never
   * reveal that something exists which the caller could not have read. A caller with no session
   * gets a clear error rather than a silently dropped subscription — there would be nowhere to
   * deliver to.
   *
   * @param ctx - The authenticated caller.
   * @param sessionId - The caller's session, or null when it has not opened one.
   */
  installSubscriptionHandlers(ctx: McpContext, sessionId: string | null): void {
    // All three are session-addressed, so each shares the same precondition: without a session
    // there is nowhere to deliver to, and silently accepting would look like it worked.
    const requireSession = (): string => {
      if (!sessionId) {
        throw new ConflictError(
          'This request needs an MCP session. Send `initialize` first and reuse the returned Mcp-Session-Id.',
        );
      }
      return sessionId;
    };

    this.protocol.setRequestHandler(SubscribeRequestSchema, async (request) => {
      const session = requireSession();
      await authorizeResourceUri(ctx, request.params.uri);
      await db
        .insert(mcpSubscription)
        .values({ sessionId: session, uri: request.params.uri })
        .onConflictDoNothing({ target: [mcpSubscription.sessionId, mcpSubscription.uri] });
      return {};
    });

    this.protocol.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      const session = requireSession();
      await db
        .delete(mcpSubscription)
        .where(
          and(eq(mcpSubscription.sessionId, session), eq(mcpSubscription.uri, request.params.uri)),
        );
      return {};
    });

    this.protocol.setRequestHandler(SetLevelRequestSchema, async (request) => {
      await setSessionLogLevel(requireSession(), request.params.level);
      return {};
    });
  }
}

/** Create an MCP catalog wrapper around an SDK server. */
export function createMcpCatalog(server: McpServer, options?: CatalogOptions): McpCatalog {
  return new McpCatalog(server, options);
}

/** Register a task-capable tool when the registrar supports tasks, else a synchronous fallback. */
export function registerOptionalTaskTool<
  OutputArgs extends ToolOutputSchema,
  InputArgs extends ToolInputSchema = undefined,
>(
  server: McpRegistrar,
  name: string,
  config: TaskToolConfig<InputArgs, OutputArgs>,
  handler: ToolTaskHandler<InputArgs>,
  fallback: ToolCallback<InputArgs>,
): RegisteredTool {
  if (server instanceof McpCatalog && server.tasksEnabled) {
    return server.registerTaskTool(name, config, handler, fallback);
  }

  return server.registerTool(
    name,
    { ...config, execution: { taskSupport: 'forbidden' } },
    fallback,
  );
}
