/**
 * `@docket/api` -- MCP catalog metadata builders.
 */
import type { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Icon, ToolAnnotations, ToolExecution } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/** Accepted forms for a tool's input schema: a raw shape, a Zod type, or none. */
export type ToolInputSchema = z.ZodRawShape | z.ZodType | undefined;
/** Accepted forms for a tool's output schema: a raw shape or a Zod type. */
export type ToolOutputSchema = z.ZodRawShape | z.ZodType;

/**
 * Declarative configuration for registering an MCP tool.
 *
 * @typeParam InputArgs - The tool's input schema type.
 * @typeParam OutputArgs - The tool's output schema type.
 */
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

/**
 * Declarative configuration for registering an MCP prompt.
 *
 * @typeParam Args - The prompt's argument schema shape.
 */
export interface PromptConfig<Args extends z.ZodRawShape> {
  readonly title?: string;
  readonly description?: string;
  readonly argsSchema?: Args;
}

/** A single tool entry as serialized in an MCP `tools/list` response. */
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

/** A single resource entry as serialized in an MCP `resources/list` response. */
export interface ResourceListValue extends ResourceMetadata {
  readonly uri: string;
  readonly name: string;
}

/** A resource-template entry as serialized in an MCP `resources/templates/list` response. */
export interface ResourceTemplateListValue extends ResourceMetadata {
  readonly uriTemplate: string;
  readonly name: string;
}

interface PromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required: boolean;
}

/** A single prompt entry as serialized in an MCP `prompts/list` response. */
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

/**
 * Build a {@link ToolListValue} from a tool's name and config, converting Zod
 * schemas to JSON Schema for the wire format.
 *
 * @typeParam InputArgs - The tool's input schema type.
 * @typeParam OutputArgs - The tool's output schema type.
 * @param name - The tool's unique name.
 * @param config - The tool's declarative configuration.
 * @returns The serializable list entry for the tool.
 */
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

/**
 * Build a {@link PromptListValue} from a prompt's name and config, deriving its
 * argument descriptors from the args schema.
 *
 * @typeParam Args - The prompt's argument schema shape.
 * @param name - The prompt's unique name.
 * @param config - The prompt's declarative configuration.
 * @returns The serializable list entry for the prompt.
 */
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
