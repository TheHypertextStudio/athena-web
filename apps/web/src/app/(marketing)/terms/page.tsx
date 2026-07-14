import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

/** Terms-of-service metadata. */
export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms governing use of Docket and its connected services.',
};

/** One terms section in the public legal-page register. */
function TermsSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="border-border flex flex-col gap-3 border-t pt-7">
      <h2 className="font-display text-ink text-2xl tracking-tight">{title}</h2>
      <div className="text-ink-muted flex flex-col gap-3 leading-relaxed">{children}</div>
    </section>
  );
}

/** Public terms of service for Docket. */
export default function TermsPage(): JSX.Element {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-20 pb-24">
      <header>
        <p className="text-ink-muted text-sm font-medium">Legal</p>
        <h1 className="font-display text-display-large-small text-ink mt-4 tracking-tight">Terms of service</h1>
        <p className="text-ink-muted mt-4">Effective July 10, 2026</p>
      </header>

      <TermsSection title="Agreement and eligibility">
        <p>
          These terms are an agreement between you and The Hypertext Studio for use of Docket. By
          creating an account or using Docket, you accept them. You must be able to form a binding
          contract and must use the service in compliance with applicable law.
        </p>
      </TermsSection>

      <TermsSection title="Accounts and connected services">
        <p>
          You are responsible for the activity under your account, protecting your passkeys and
          recovery codes, and maintaining accurate contact information. Only connect accounts and
          organizations you are authorized to access. Third-party services such as Google remain
          governed by their own terms, and you can disconnect them at any time.
        </p>
      </TermsSection>

      <TermsSection title="Your content">
        <p>
          You retain ownership of content you submit or synchronize. You grant Docket a limited
          license to host, process, reproduce, and transmit that content only as needed to operate,
          secure, support, and improve the service. You represent that you have the rights needed to
          provide the content and authorize requested connector actions.
        </p>
      </TermsSection>

      <TermsSection title="Acceptable use">
        <p>
          Do not use Docket to break the law, infringe rights, access accounts without permission,
          distribute malware, evade security controls, interfere with the service, scrape it at
          unreasonable volume, or expose another person&apos;s confidential information without
          authorization.
        </p>
      </TermsSection>

      <TermsSection title="Service changes and termination">
        <p>
          We may change, suspend, or discontinue features and will use reasonable efforts to give
          notice of material changes. You may stop using Docket and request deletion at any time. We
          may suspend access to address security risks, legal requirements, nonpayment, or material
          violations of these terms. Available export and recovery periods are described in the
          product and Privacy Policy.
        </p>
      </TermsSection>

      <TermsSection title="Disclaimers and liability">
        <p>
          Docket is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis to the
          extent permitted by law. We do not guarantee uninterrupted operation or that synchronized
          data will always be complete or current. You should keep appropriate source-system records
          and backups for critical work.
        </p>
        <p>
          To the maximum extent permitted by law, The Hypertext Studio is not liable for indirect,
          incidental, special, consequential, or punitive damages, or for lost profits, revenues,
          data, or goodwill arising from use of Docket.
        </p>
      </TermsSection>

      <TermsSection title="Contact and changes">
        <p>
          We may revise these terms and will post the effective date above. Material changes apply
          prospectively after reasonable notice. Questions can be sent to{' '}
          <a className="text-ink underline" href="mailto:support@hypertext.studio">
            support@hypertext.studio
          </a>
          .
        </p>
      </TermsSection>
    </article>
  );
}
