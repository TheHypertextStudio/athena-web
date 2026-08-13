import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canWriteClipboard,
  canWriteRichClipboard,
  escapeHtml,
  writeClipboard,
  writeClipboardData,
} from '../../../src/lib/clipboard/write';

/**
 * The clipboard write is the only thing standing between "copy preserved my formatting" and a wall
 * of flattened prose, and every one of its branches is a platform difference that cannot be
 * reproduced by reading the code: a browser with no `ClipboardItem`, a browser that refuses a rich
 * write, a permission denial. Each degrades to a *different* correct outcome, so each is pinned.
 */

/**
 * A `Blob` stand-in that keeps its parts readable.
 *
 * @remarks
 * jsdom's `Blob` and Node's differ on which read methods exist, and neither difference is anything
 * this module is responsible for. Recording the parts asserts what was written without depending on
 * how a given environment lets it be read back.
 */
class FakeBlob {
  constructor(
    readonly parts: readonly string[],
    readonly options: { readonly type: string },
  ) {}
}

/** The flavors the most recent `ClipboardItem` was constructed with. */
let lastItem: Record<string, Promise<FakeBlob>> | null = null;

/**
 * A `ClipboardItem` stand-in that records what it was constructed with.
 *
 * @remarks
 * A real class, not a `vi.fn`: the module calls `new ClipboardItem(...)`, and a mock whose
 * implementation is an arrow function is not constructible — the resulting `TypeError` is swallowed
 * by the module's own fallback, and the test then silently exercises the plain-text path instead of
 * the rich one it is named for.
 */
class FakeClipboardItem {
  /** The flavors this item carries, mirroring the platform's own `types`. */
  readonly types: readonly string[];

  constructor(items: Record<string, Promise<FakeBlob>>) {
    this.types = Object.keys(items);
    lastItem = items;
  }
}

/** Read a recorded flavor back as text. */
async function flavor(type: string): Promise<string | null> {
  const entry = lastItem?.[type];
  if (entry === undefined) return null;
  return (await entry).parts.join('');
}

const write = vi.fn<(items: unknown[]) => Promise<void>>();
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  lastItem = null;
  write.mockReset().mockResolvedValue(undefined);
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  vi.stubGlobal('Blob', FakeBlob);
  vi.stubGlobal('navigator', { clipboard: { write, writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('writeClipboard', () => {
  it('offers both a rich and a plain flavor so the paste target can choose', async () => {
    const wrote = await writeClipboard({ html: '<p>Hello</p>', text: 'Hello' });

    expect(wrote).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    await expect(flavor('text/html')).resolves.toBe('<p>Hello</p>');
    await expect(flavor('text/plain')).resolves.toBe('Hello');
  });

  it('writes only plain text when the payload has no rich form', async () => {
    const wrote = await writeClipboard({ html: '', text: 'const x = 1;' });

    expect(wrote).toBe(true);
    // An empty `text/html` is worse than none: a rich target prefers it and pastes nothing.
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('const x = 1;');
  });

  it('falls back to plain text where the platform has no ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined);

    const wrote = await writeClipboard({ html: '<p>Hi</p>', text: 'Hi' });

    expect(wrote).toBe(true);
    expect(writeText).toHaveBeenCalledWith('Hi');
  });

  it('still lands the plain flavor when the rich write is refused', async () => {
    write.mockRejectedValueOnce(new Error('not allowed'));

    const wrote = await writeClipboard({ html: '<p>Hi</p>', text: 'Hi' });

    expect(wrote).toBe(true);
    expect(writeText).toHaveBeenCalledWith('Hi');
  });

  it('reports failure rather than throwing into the caller’s event handler', async () => {
    write.mockRejectedValueOnce(new Error('denied'));
    writeText.mockRejectedValueOnce(new Error('denied'));

    await expect(writeClipboard({ html: '<p>Hi</p>', text: 'Hi' })).resolves.toBe(false);
  });

  it('reports failure where there is no clipboard at all', async () => {
    vi.stubGlobal('navigator', {});

    await expect(writeClipboard({ html: '<p>Hi</p>', text: 'Hi' })).resolves.toBe(false);
  });
});

describe('clipboard capability probes', () => {
  it('reports both capabilities when the platform provides them', () => {
    expect(canWriteClipboard()).toBe(true);
    expect(canWriteRichClipboard()).toBe(true);
  });

  it('reports plain-only where ClipboardItem is missing', () => {
    vi.stubGlobal('ClipboardItem', undefined);

    expect(canWriteClipboard()).toBe(true);
    expect(canWriteRichClipboard()).toBe(false);
  });

  it('reports no clipboard where the API is absent', () => {
    vi.stubGlobal('navigator', {});

    expect(canWriteClipboard()).toBe(false);
  });
});

describe('writeClipboardData', () => {
  /** A `DataTransfer` stand-in; jsdom implements none. */
  function fakeData(): { data: Map<string, string>; transfer: DataTransfer } {
    const data = new Map<string, string>();
    return {
      data,
      transfer: {
        setData: (type: string, value: string) => data.set(type, value),
      } as unknown as DataTransfer,
    };
  }

  it('writes both flavors onto the event’s own clipboard data', () => {
    const { data, transfer } = fakeData();

    expect(writeClipboardData(transfer, { html: '<a href="/x">X</a>', text: '[X](/x)' })).toBe(
      true,
    );
    expect(data.get('text/plain')).toBe('[X](/x)');
    expect(data.get('text/html')).toBe('<a href="/x">X</a>');
  });

  it('omits the rich flavor rather than writing an empty one', () => {
    const { data, transfer } = fakeData();

    writeClipboardData(transfer, { html: '', text: 'plain' });

    expect(data.get('text/plain')).toBe('plain');
    expect(data.has('text/html')).toBe(false);
  });

  it('reports failure when the event carried no clipboard data', () => {
    expect(writeClipboardData(null, { html: '<p>x</p>', text: 'x' })).toBe(false);
  });

  it('reports failure rather than throwing when the platform refuses the write', () => {
    const transfer = {
      setData: () => {
        throw new Error('read-only clipboard');
      },
    } as unknown as DataTransfer;

    expect(writeClipboardData(transfer, { html: '<p>x</p>', text: 'x' })).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('keeps markup-significant characters in a title as text', () => {
    expect(escapeHtml('Fix <Button> & "Input"')).toBe('Fix &lt;Button&gt; &amp; &quot;Input&quot;');
  });
});
