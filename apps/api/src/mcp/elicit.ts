/**
 * `@docket/api` — asking the person which one they meant.
 *
 * @remarks
 * An ambiguous name is the one failure on this surface with an obviously better answer than an
 * error. "Platform" matching two projects is not a mistake the caller made — it is a question, and
 * the MCP elicitation flow exists to ask it in the host's own chrome and get a small answer back.
 *
 * The fallback is not a degradation. A client that does not advertise `elicitation` still gets the
 * {@link ValidationError} carrying every candidate, which is enough for a model to re-issue the
 * call correctly on its own. Eliciting saves a round trip and puts the choice in front of the
 * person rather than the model; it is not the only way through.
 *
 * Elicitation carries flat primitives only, so this is deliberately used for *one* choice with a
 * short list. A decision spread over repeated rows belongs in a widget, not in a form.
 */

/** The one field shape this module ever asks for: pick a label from a short list. */
export interface EnumField {
  type: 'string';
  title?: string;
  enum: string[];
}

/**
 * The two server methods asking a question needs.
 *
 * @remarks
 * A named port rather than the SDK's `Server`, which is deprecated in favour of the high-level
 * `McpServer` even though `elicitInput` still lives only on the low-level one. Depending on the
 * shape instead of the class also means this module can be exercised without standing up a server.
 */
export interface Elicitor {
  getClientCapabilities(): { readonly elicitation?: unknown } | undefined;
  elicitInput(params: {
    message: string;
    requestedSchema: {
      type: 'object';
      properties: Record<string, EnumField>;
      required?: string[];
    };
  }): Promise<{ action: string; content?: Record<string, unknown> }>;
}

/** How many candidates are worth putting in front of a person as a list. */
const MAX_CHOICES = 10;

/** One thing the caller might have meant. */
export interface Choice {
  readonly id: string;
  readonly label: string;
}

/**
 * Ask the caller to pick one of `choices`, or return null when asking is not possible.
 *
 * @remarks
 * Returns null — rather than throwing — for every non-answer: a client without the capability, a
 * list too long to be a sensible prompt, a decline, a cancel, or a transport failure. Every one of
 * those means "carry on and report the ambiguity", which is exactly what the caller does with it.
 * Making this throw would turn a client that simply cannot ask into a client that cannot resolve
 * names at all.
 *
 * @param server - The low-level server for this request, or null when there is none.
 * @param field - The parameter being resolved, used in the prompt.
 * @param value - What the caller typed.
 * @param choices - What it could have meant.
 * @returns the chosen id, or null when the question could not be asked or was not answered.
 */
export async function askWhichOne(
  server: Elicitor | null,
  field: string,
  value: string,
  choices: readonly Choice[],
): Promise<string | null> {
  if (!server) return null;
  if (choices.length < 2 || choices.length > MAX_CHOICES) return null;
  if (!server.getClientCapabilities()?.elicitation) return null;

  const byLabel = new Map(choices.map((choice) => [choice.label, choice.id]));

  try {
    const result = await server.elicitInput({
      message: `"${value}" matches more than one ${field}. Which did you mean?`,
      requestedSchema: {
        type: 'object',
        properties: {
          choice: {
            type: 'string',
            title: field,
            // Labels rather than ids: the person is picking a name they recognize, and the
            // mapping back is ours to do.
            enum: choices.map((choice) => choice.label),
          },
        },
        required: ['choice'],
      },
    });

    if (result.action !== 'accept') return null;
    const picked = result.content?.['choice'];
    return typeof picked === 'string' ? (byLabel.get(picked) ?? null) : null;
  } catch {
    // A client that advertises elicitation and then fails to deliver it is still a client whose
    // call should resolve the ordinary way.
    return null;
  }
}
