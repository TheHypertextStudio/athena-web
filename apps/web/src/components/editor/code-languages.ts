/** A language offered by the Markdown code-block editor. */
export interface CodeLanguage {
  /** The canonical Markdown fence id. Empty means an unlabelled plain-text fence. */
  readonly id: string;
  /** Human-readable text shown in the block rail. */
  readonly label: string;
  /** Fence aliases that use the same grammar and label. */
  readonly aliases: readonly string[];
  /** The Highlight.js grammar chunk, omitted when highlighting must stay off. */
  readonly grammar?: CodeGrammar;
}

/** The finite set of grammar chunks that Docket can request on demand. */
export type CodeGrammar =
  | 'bash'
  | 'css'
  | 'diff'
  | 'xml'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'python'
  | 'sql'
  | 'typescript'
  | 'yaml';

/** The intentionally small language vocabulary shown to authors. */
export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: '', label: 'Plain text', aliases: ['text', 'plaintext', 'txt'] },
  { id: 'bash', label: 'Bash', aliases: ['sh', 'shell'], grammar: 'bash' },
  { id: 'css', label: 'CSS', aliases: [], grammar: 'css' },
  { id: 'diff', label: 'Diff', aliases: ['patch'], grammar: 'diff' },
  { id: 'html', label: 'HTML', aliases: ['xml'], grammar: 'xml' },
  { id: 'javascript', label: 'JavaScript', aliases: ['js'], grammar: 'javascript' },
  { id: 'jsx', label: 'JSX', aliases: [], grammar: 'javascript' },
  { id: 'json', label: 'JSON', aliases: [], grammar: 'json' },
  { id: 'markdown', label: 'Markdown', aliases: ['md'], grammar: 'markdown' },
  { id: 'python', label: 'Python', aliases: ['py'], grammar: 'python' },
  { id: 'sql', label: 'SQL', aliases: [], grammar: 'sql' },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts'], grammar: 'typescript' },
  { id: 'tsx', label: 'TSX', aliases: [], grammar: 'typescript' },
  { id: 'yaml', label: 'YAML', aliases: ['yml'], grammar: 'yaml' },
] as const;

/** Resolve a stored fence id to the catalog entry that can present it. */
export function codeLanguage(value: string | null | undefined): CodeLanguage | undefined {
  const normalized = value?.trim().toLowerCase() ?? '';
  return CODE_LANGUAGES.find(
    (language) => language.id === normalized || language.aliases.includes(normalized),
  );
}

/** Present known fence ids cleanly while keeping unknown ids honest and visible. */
export function codeLanguageLabel(value: string | null | undefined): string {
  const normalized = value?.trim() ?? '';
  return codeLanguage(normalized)?.label ?? (normalized || 'Plain text');
}
