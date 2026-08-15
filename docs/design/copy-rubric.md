# Docket copy rubric

> **Version:** 1.0.0
> **Last updated:** 2026-08-15

Every customer-facing page is judged property by property. Each property is binary:

- **Aligned:** every material sentence supports the property.
- **Misaligned:** any material sentence fails it, including mixed evidence.

There are no partial scores. A page passes only when all 15 properties are Aligned.

## Voice

| Property         | Aligned                                                            | Misaligned                                                                                                      |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Specificity      | Names the record, action, price, state, consequence, or next step. | Uses claims that could describe another product: powerful, seamless, smarter, all-in-one, effortless.           |
| Directness       | States the fact or instruction once in the shortest complete form. | Builds up to the point, repeats it, adds throat-clearing, or narrates the interface.                            |
| Confidence       | Uses unqualified claims that the product can prove.                | Uses hype, defensive explanation, hedging, rhetorical questions, or unsupported superlatives.                   |
| Vocabulary       | Uses Docket's actual products, records, states, and actions.       | Invents metaphors, uses internal implementation jargon, calls products tiers, or renames a concept for variety. |
| Reader awareness | Gives the person the information needed for the current decision.  | Explains company history, competitor behavior, hypothetical users, or details that do not change the decision.  |

## Character

| Property        | Aligned                                                                                      | Misaligned                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Point of view   | Keeps the same relationship among Docket, the reader, and third parties throughout the page. | Switches among “we,” “you,” passive voice, and abstract product narration without purpose.                     |
| Distinctiveness | Could only be Docket because it names Docket's real work model or mechanics.                 | Sounds like generic SaaS copy, a startup template, or a generated feature summary.                             |
| Restraint       | Uses one claim, one explanation, and one action where those are sufficient.                  | Stacks slogans, adjectives, benefits, reassurance, or repeated calls to action.                                |
| Naturalness     | Reads like a person stating a useful fact.                                                   | Uses symmetrical slogan patterns, forced contrasts, em-dash conclusions, “whether X or Y,” or polished filler. |
| Honesty         | Matches implemented behavior and names limits or timing when they matter.                    | Promises unavailable policy, support, compatibility, automation, pricing, safety, or immediate activation.     |

## Structure

| Property       | Aligned                                                                                        | Misaligned                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Single purpose | Every block helps the reader understand or complete the page's one job.                        | Combines positioning, education, reassurance, history, and purchase arguments on one surface.                                |
| Progression    | Information arrives in decision order: state, consequence, action; or claim, evidence, action. | Jumps between concepts, reveals a condition after the action, or makes the reader backtrack.                                 |
| Economy        | No sentence duplicates a heading, control label, metadata line, or nearby sentence.            | Restates titles, primary actions, positioning, no-card notes, signed-in status, or footer claims.                            |
| Shape          | Paragraph and section lengths reflect the importance and complexity of the content.            | Produces uniform three-item lists, repeated card grids, equal-length sections, or padded subtitles.                          |
| Hierarchy      | The primary claim or action is obvious; supporting facts are subordinate.                      | Gives multiple claims or actions equal weight, buries the actual condition, or promotes implementation detail into the hero. |

## Generated-copy checks

The property review is authoritative; phrase matching is only a regression net. Investigate copy
that contains any of these patterns:

- Empty outcome language: “work smarter,” “stay on top of,” “everything you need,” “nothing slips
  through the cracks,” “built for modern teams.”
- Product metaphors standing in for mechanics: “command center,” “calm home,” “launchpad,” “single
  source of truth,” “copilot.”
- Unproved compatibility or permission programs: “approved AI clients,” “allowed MCP clients,”
  “supported clients.” MCP access is determined by OAuth, scopes, grants, network safety, and owned
  product capabilities.
- Artificial contrast: “not just X, but Y,” “from X to Y,” “whether you are X or Y.”
- Interface narration: “you are already signed in,” “pick up where you left off,” “get started in
  seconds,” or descriptions that repeat the button.
- Commercial inventions: plan tiers, priority support, nonprofit pricing, unlimited claims, or a
  trial/cancellation promise that is not enforced by billing code.
- Unnecessary reassurance: “rest assured,” “we've got you covered,” “nothing has been lost,” or
  vague error text without the failed action and recovery.

## Page gate

Audit home, pricing, about, privacy, terms, problems, sign-in, sign-up, recovery, OAuth consent,
onboarding, checkout return, and billing settings. Record one `Aligned` or `Misaligned` result for
each property. If one result is Misaligned, fix the copy and audit the whole page again.
