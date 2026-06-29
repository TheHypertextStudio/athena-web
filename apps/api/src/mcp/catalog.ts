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
import type { LoggingMessageNotification } from '@modelcontextprotocol/sdk/types.js';
import {
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

import type { McpContext } from './auth';
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

type ListResourcesRequest = z.infer<typeof ListResourcesRequestSchema>;
type ListResourceTemplatesRequest = z.infer<typeof ListResourceTemplatesRequestSchema>;
type ListPromptsRequest = z.infer<typeof ListPromptsRequestSchema>;
type ListToolsRequest = z.infer<typeof ListToolsRequestSchema>;

interface CatalogOptions {
  readonly pageSize?: number;
}

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
    this.protocol = mcp.server;
  }

  registerTool<OutputArgs extends ToolOutputSchema, InputArgs extends ToolInputSchema = undefined>(
    name: string,
    config: ToolConfig<InputArgs, OutputArgs>,
    cb: ToolCallback<InputArgs>,
  ): RegisteredTool {
    this.tools.push({ key: name, value: toolListValue(name, config) });
    return this.mcp.registerTool(name, config, cb);
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

  sendLoggingMessage(
    params: LoggingMessageNotification['params'],
    sessionId?: string,
  ): Promise<void> {
    return this.mcp.sendLoggingMessage(params, sessionId);
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
}

/** Create an MCP catalog wrapper around an SDK server. */
export function createMcpCatalog(server: McpServer, options?: CatalogOptions): McpCatalog {
  return new McpCatalog(server, options);
}
