/**
 * `@docket/api` -- MCP catalog metadata builders.
 */
import type { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Icon, ToolAnnotations, ToolExecution } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export type ToolInputSchema = z.ZodRawShape | z.ZodType | undefined;
export type ToolOutputSchema = z.ZodRawShape | z.ZodType;

export interface ToolConfig<
  InputArgs extends ToolInputSchema,
  OutputArgs extends ToolOutputSchema,
> {
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: InputArgs;
  readonly outputSchema?: OutputArgs;
  readonly annotations?: ToolAnnotations;
  readonly icons?: readonly Icon[];
  readonly execution?: ToolExecution;
  readonly _meta?: Record<string, unknown>;
}

export interface PromptConfig<Args extends z.ZodRawShape> {
  readonly title?: string;
  readonly description?: string;
  readonly argsSchema?: Args;
}

export interface ToolListValue {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations?: ToolAnnotations;
  readonly icons?: readonly Icon[];
  readonly execution?: ToolExecution;
  readonly _meta?: Record<string, unknown>;
}

export interface ResourceListValue extends ResourceMetadata {
  readonly uri: string;
  readonly name: string;
}

export interface ResourceTemplateListValue extends ResourceMetadata {
  readonly uriTemplate: string;
  readonly name: string;
}

interface PromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required: boolean;
}

export interface PromptListValue {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly arguments?: readonly PromptArgument[];
}

const PromptJsonSchema = z
  .object({
    properties: z
      .record(z.string(), z.looseObject({ description: z.string().optional() }))
      .optional(),
    required: z.array(z.string()).optional(),
  })
  .loose();

function isZodSchema(schema: ToolOutputSchema): schema is z.ZodType {
  return schema instanceof z.ZodType;
}

function schemaToJson(schema: ToolInputSchema): Record<string, unknown> {
  if (!schema) return { type: 'object', properties: {} };
  return isZodSchema(schema) ? z.toJSONSchema(schema) : z.toJSONSchema(z.object(schema));
}

function outputSchemaToJson(
  schema: ToolOutputSchema | undefined,
): Record<string, unknown> | undefined {
  return schema ? schemaToJson(schema) : undefined;
}

function promptArguments(schema: z.ZodRawShape | undefined): readonly PromptArgument[] | undefined {
  if (!schema) return undefined;
  const jsonSchema = PromptJsonSchema.parse(z.toJSONSchema(z.object(schema)));
  const required = new Set(jsonSchema.required ?? []);
  return Object.keys(schema).map((name) => ({
    name,
    description: jsonSchema.properties?.[name]?.description,
    required: required.has(name),
  }));
}

export function toolListValue<
  InputArgs extends ToolInputSchema,
  OutputArgs extends ToolOutputSchema,
>(name: string, config: ToolConfig<InputArgs, OutputArgs>): ToolListValue {
  return {
    name,
    title: config.title,
    description: config.description,
    inputSchema: schemaToJson(config.inputSchema),
    outputSchema: outputSchemaToJson(config.outputSchema),
    annotations: config.annotations,
    icons: config.icons,
    execution: config.execution ?? { taskSupport: 'forbidden' },
    _meta: config._meta,
  };
}

export function promptListValue<Args extends z.ZodRawShape>(
  name: string,
  config: PromptConfig<Args>,
): PromptListValue {
  return {
    name,
    title: config.title,
    description: config.description,
    arguments: promptArguments(config.argsSchema),
  };
}
