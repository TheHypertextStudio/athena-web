import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MailFiles } from '../../src/components/athena/mail-files';

afterEach(cleanup);

describe('received email files', () => {
  it('offers a download only for a ready file through the owner-authorized endpoint', () => {
    render(
      <MailFiles
        messageId="mail/one"
        files={[
          {
            id: 'file/one',
            filename: 'notes.txt',
            contentType: 'text/plain',
            status: 'ready',
            size: 14,
          },
          {
            id: 'file/two',
            filename: 'report.pdf',
            contentType: 'application/pdf',
            status: 'rejected',
            errorCode: 'attachment_unsupported',
          },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Download notes.txt' })).toHaveAttribute(
      'href',
      '/v1/me/athena/mail/channel/attachments/mail%2Fone/file%2Fone',
    );
    expect(screen.queryByRole('link', { name: 'Download report.pdf' })).not.toBeInTheDocument();
    expect(screen.getByText('This file type is not supported.')).toBeInTheDocument();
  });

  it('shows application-owned recovery copy for unavailable files and unknown diagnostics', () => {
    render(
      <MailFiles
        messageId="mail"
        files={[
          {
            id: 'one',
            filename: 'notes.txt',
            contentType: 'text/plain',
            status: 'unavailable',
            errorCode: 'PRIVATE PROVIDER DIAGNOSTIC',
          },
          { id: 'two', filename: 'other.csv', contentType: 'text/csv' },
        ]}
      />,
    );
    expect(
      screen.getByText('This file is not available yet. Athena will retry.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Waiting for file processing.')).toBeInTheDocument();
    expect(screen.queryByText('PRIVATE PROVIDER DIAGNOSTIC')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
