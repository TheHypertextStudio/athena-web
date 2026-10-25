import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliverableOut } from '@docket/work/attachment-contract';
import { TooltipProvider } from '@docket/ui/primitives';
import { AttachmentId } from '@docket/work/ids';
import { ApiRequestError } from '../../src/lib/query-core';

const { discard } = vi.hoisted(() => ({ discard: vi.fn() }));
vi.mock('../../src/lib/api', () => ({
  api: { v1: { orgs: { ':orgId': { deliverables: { ':id': { $delete: discard } } } } } },
}));
vi.mock('../../src/lib/query', () => ({
  queryKeys: { deliverableDrafts: (orgId: string) => ['org', orgId, 'deliverables', 'drafts'] },
  apiQueryOptions: (_key: unknown, queryFn: unknown) => ({ queryFn }),
  unwrap: (call: () => Promise<Response>) =>
    call().then(async (response) => {
      if (!response.ok) throw new Error('request_failed');
      return response.json();
    }),
  useApiMutation: () => ({ mutateAsync: discard }),
  useApiQuery: () => ({ data: { items: [] } }),
}));
import {
  DeliverableList,
  DeliverablePicker,
} from '../../src/components/entity-detail/deliverables';

const uploaded: DeliverableOut = {
  id: AttachmentId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  title: 'Finished report.png',
  fileName: 'Finished report.png',
  mimeType: 'image/png',
  byteSize: 1200,
  downloadUrl: '/v1/orgs/workspace/deliverables/file/download',
  previewUrl: '/v1/orgs/workspace/deliverables/file/preview',
};

class FakeUploadRequest {
  static requests: FakeUploadRequest[] = [];
  static defer = false;
  static status = 201;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = FakeUploadRequest.status;
  responseText = JSON.stringify(uploaded);
  withCredentials = false;
  sent: FormData | null = null;
  constructor() {
    FakeUploadRequest.requests.push(this);
  }
  open = vi.fn();
  setRequestHeader = vi.fn();
  send(form: FormData): void {
    this.sent = form;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    if (!FakeUploadRequest.defer) this.onload?.();
  }
  abort(): void {
    this.onabort?.();
  }
  finish(status = 201): void {
    this.status = status;
    this.onload?.();
  }
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  FakeUploadRequest.requests = [];
  FakeUploadRequest.defer = false;
  FakeUploadRequest.status = 201;
});

function Composer() {
  const [files, setFiles] = useState<DeliverableOut[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <DeliverablePicker
        orgId="workspace"
        files={files}
        disabled={false}
        onChange={setFiles}
        onBusy={setBusy}
        primaryAction={<button disabled={busy}>Post</button>}
      />
    </>
  );
}
function renderComposer() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <TooltipProvider>
        <Composer />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('deliverable picker', () => {
  it('can remove a local selection whose draft expired or already posted', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest);
    discard.mockRejectedValue(new ApiRequestError({ status: 404, message: 'Unavailable file.' }));
    renderComposer();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose files to attach'),
      new File(['image'], 'Finished report.png', { type: 'image/png' }),
    );
    await user.click(await screen.findByRole('button', { name: `Remove ${uploaded.title}` }));
    await waitFor(() => {
      expect(screen.queryByText(uploaded.title)).not.toBeInTheDocument();
    });
  });

  it('keeps a selected draft after a transient discard failure', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest);
    discard.mockRejectedValue(
      new ApiRequestError({ status: 503, message: 'Unavailable service.' }),
    );
    renderComposer();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose files to attach'),
      new File(['image'], 'Finished report.png', { type: 'image/png' }),
    );
    await user.click(await screen.findByRole('button', { name: `Remove ${uploaded.title}` }));
    expect(await screen.findByText('Could not remove that file. Try again.')).toBeVisible();
    expect(screen.getByText(uploaded.title)).toBeVisible();
  });

  it('uploads a file, shows its image preview and removes it only after discard succeeds', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest);
    discard.mockResolvedValue(new Response(JSON.stringify({ removed: true })));
    renderComposer();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose files to attach'),
      new File(['image'], 'Finished report.png', { type: 'image/png' }),
    );
    expect(await screen.findByText(uploaded.title)).toBeVisible();
    expect(screen.getByRole('img', { name: uploaded.title })).toHaveAttribute(
      'src',
      uploaded.previewUrl,
    );
    expect(FakeUploadRequest.requests[0]?.sent?.get('file')).toBeInstanceOf(File);
    expect(FakeUploadRequest.requests[0]?.withCredentials).toBe(true);
    await user.click(screen.getByRole('button', { name: `Remove ${uploaded.title}` }));
    await waitFor(() => expect(screen.queryByText(uploaded.title)).not.toBeInTheDocument());
  });

  it('retains the failed File and retries that file without asking the person to choose it again', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest);
    FakeUploadRequest.status = 503;
    renderComposer();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose files to attach'),
      new File(['report'], 'report.pdf'),
    );
    expect(await screen.findByText('Upload failed. Retry or remove this file.')).toBeVisible();
    expect(FakeUploadRequest.requests).toHaveLength(1);
    FakeUploadRequest.status = 201;
    await user.click(screen.getByRole('button', { name: 'Retry upload of report.pdf' }));
    expect(await screen.findByText(uploaded.title)).toBeVisible();
    expect(FakeUploadRequest.requests).toHaveLength(2);
    expect(FakeUploadRequest.requests[1]?.sent?.get('file')).toBeInstanceOf(File);
    expect(FakeUploadRequest.requests[0]?.sent?.get('uploadId')).toBe(
      FakeUploadRequest.requests[1]?.sent?.get('uploadId'),
    );
    await user.upload(
      screen.getByLabelText('Choose files to attach'),
      new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.pdf'),
    );
    expect(await screen.findByText('Choose non-empty files up to 4 MB each.')).toBeVisible();
    expect(FakeUploadRequest.requests).toHaveLength(2);
  });

  it('shows byte progress and keeps a cancelled upload available for retry', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest);
    FakeUploadRequest.defer = true;
    renderComposer();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose files to attach'),
      new File(['report'], 'report.pdf'),
    );
    expect(screen.getByRole('progressbar', { name: 'Uploading report.pdf' })).toHaveValue(50);
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel upload of report.pdf' }));
    expect(await screen.findByText('Upload cancelled. Retry or remove this file.')).toBeVisible();
    FakeUploadRequest.defer = false;
    await user.click(screen.getByRole('button', { name: 'Retry upload of report.pdf' }));
    expect(await screen.findByText(uploaded.title)).toBeVisible();
  });

  it('does not upload a queued file after it is removed while an earlier file is uploading', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest);
    FakeUploadRequest.defer = true;
    renderComposer();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose files to attach'), [
      new File(['first'], 'first.pdf'),
      new File(['second'], 'second.pdf'),
    ]);
    expect(screen.getByRole('progressbar', { name: 'Uploading first.pdf' })).toBeInTheDocument();
    expect(screen.getByText('second.pdf')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove second.pdf from this upload' }));
    FakeUploadRequest.requests[0]?.finish();
    await waitFor(() => expect(screen.getByText(uploaded.title)).toBeVisible());
    expect(FakeUploadRequest.requests).toHaveLength(1);
    expect(screen.queryByText('second.pdf')).not.toBeInTheDocument();
  });

  it('does not upload a queued file after it is cancelled while an earlier file is uploading', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest);
    FakeUploadRequest.defer = true;
    renderComposer();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose files to attach'), [
      new File(['first'], 'first.pdf'),
      new File(['second'], 'second.pdf'),
    ]);
    expect(screen.getByRole('progressbar', { name: 'Uploading first.pdf' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel upload of second.pdf' }));
    expect(await screen.findByText('Upload cancelled. Retry or remove this file.')).toBeVisible();
    FakeUploadRequest.defer = false;
    FakeUploadRequest.requests[0]?.finish();
    await waitFor(() => {
      expect(screen.getAllByText(uploaded.title)).toHaveLength(1);
    });
    expect(FakeUploadRequest.requests).toHaveLength(1);
    expect(screen.getByText('Upload cancelled. Retry or remove this file.')).toBeVisible();
  });
});

describe('posted deliverables', () => {
  it.each([
    { mimeType: 'audio/mpeg', tag: 'audio' },
    { mimeType: 'video/mp4', tag: 'video' },
    { mimeType: 'AUDIO/MPEG', tag: 'audio' },
    { mimeType: 'VIDEO/MP4', tag: 'video' },
  ])('offers native playback controls for $mimeType', ({ mimeType, tag }) => {
    render(<DeliverableList files={[{ ...uploaded, mimeType }]} />);
    const player = screen.getByLabelText(uploaded.title);
    expect(player.tagName.toLowerCase()).toBe(tag);
    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('src', uploaded.previewUrl);
    expect(screen.getByRole('link', { name: uploaded.title })).toHaveAttribute(
      'download',
      uploaded.fileName,
    );
  });

  it('offers a named download and a safe raster preview', () => {
    render(<DeliverableList files={[{ ...uploaded, mimeType: 'IMAGE/PNG' }]} />);
    expect(screen.getByRole('link', { name: uploaded.title })).toHaveAttribute(
      'href',
      uploaded.downloadUrl,
    );
    expect(screen.getByRole('img', { name: uploaded.title })).toHaveAttribute(
      'src',
      uploaded.previewUrl,
    );
    expect(screen.getByRole('link')).toHaveAttribute('download', uploaded.fileName);
  });
});
