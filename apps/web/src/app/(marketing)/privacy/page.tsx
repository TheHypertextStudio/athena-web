import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

/** Privacy-policy metadata. */
export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'How Docket collects, uses, protects, and deletes account and Google Workspace data.',
};

/** One policy section in the public legal-page register. */
function PolicySection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="border-border flex flex-col gap-3 border-t pt-7">
      <h2 className="font-display text-ink text-2xl tracking-tight">{title}</h2>
      <div className="text-ink-muted flex flex-col gap-3 leading-relaxed">{children}</div>
    </section>
  );
}

/** Public privacy policy for Docket, including Google API Limited Use disclosures. */
export default function PrivacyPage(): JSX.Element {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-20 pb-24">
      <header>
        <p className="text-ink-muted text-sm font-medium">Legal</p>
        <h1 className="font-display text-display-large-small text-ink mt-4 tracking-tight">Privacy policy</h1>
        <p className="text-ink-muted mt-4">Effective July 10, 2026</p>
      </header>

      <PolicySection title="Who operates Docket">
        <p>
          Docket is operated by The Hypertext Studio. Questions, access requests, and deletion
          requests can be sent to{' '}
          <a className="text-ink underline" href="mailto:support@hypertext.studio">
            support@hypertext.studio
          </a>
          .
        </p>
      </PolicySection>

      <PolicySection title="Information we collect">
        <p>
          We process account profile details, passkey and session metadata, the organizations and
          work you create, product settings, support communications, and technical logs needed to
          secure and operate Docket. We do not store passkey private keys.
        </p>
        <p>
          When you authorize a connector, we also process the provider account identifier, granted
          scopes, encrypted OAuth access and refresh tokens, synchronization cursors, and the data
          needed to provide that connector.
        </p>
      </PolicySection>

      <PolicySection title="Google user data">
        <p>
          Google access is optional and requested incrementally. Calendar access lets Docket list
          your calendars, display selected events, detect changes, and create, update, or delete
          events when you use editing features. Tasks access supports two-way task synchronization.
          Drive read-only access lets you find and attach files you choose. Gmail modify access lets
          Docket read relevant message metadata and content and apply mailbox actions you request.
        </p>
        <p>
          Docket uses Google user data only to provide or improve the user-facing features you
          initiate. We do not sell Google user data, use it for advertising, transfer it to data
          brokers, or use it to train generalized artificial-intelligence models.
        </p>
        <p>
          Docket&apos;s use and transfer of information received from Google APIs adheres to the
          Google API Services User Data Policy, including the Limited Use requirements.
        </p>
      </PolicySection>

      <PolicySection title="Storage and sharing">
        <p>
          OAuth bearer tokens are encrypted before database storage. Docket stores application data
          with contracted infrastructure providers, including Google Cloud, Neon, Vercel, and
          Cloudflare, only as needed to host, secure, back up, and deliver the service. We may also
          disclose information when required by law or to protect users and the service.
        </p>
      </PolicySection>

      <PolicySection title="Retention and your controls">
        <p>
          Connector data remains while the account is linked and as needed for synchronization.
          Unlinking a Google account removes its encrypted tokens and cached Calendar data. You can
          also revoke Docket in your Google Account security settings. Organization records that
          originated from a connector may remain as Docket work history but lose access to the
          provider and are marked for reconnection.
        </p>
        <p>
          Account deletion uses a 14-day recovery period. After that period Docket deletes the
          account and associated personal data, subject to limited security, legal, and backup
          retention obligations. You may export your data before deletion.
        </p>
      </PolicySection>

      <PolicySection title="Security, changes, and rights">
        <p>
          We use access controls, encryption, tenant isolation, audit logging, and operational
          monitoring appropriate to the data we process. No system is completely secure. Depending
          on where you live, you may have rights to access, correct, export, restrict, object to, or
          delete personal information.
        </p>
        <p>
          We will update this page when practices materially change and will provide additional
          notice when required. Contact support to exercise a right or raise a concern.
        </p>
      </PolicySection>
    </article>
  );
}
