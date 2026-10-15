import type { Metadata } from 'next';
import type { JSX } from 'react';

import {
  LegalPolicyContact,
  LegalPolicyDocument,
  type LegalPolicySection,
} from '@/components/marketing/legal-policy-document';

/** Terms-of-service metadata. */
export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms governing use of Docket and its connected services.',
};

const sections: readonly LegalPolicySection[] = [
  {
    title: 'Operator and scope',
    body: (
      <p>
        These terms are an agreement between you and Hypertext Studio for Docket, Docket Pro,
        Athena, and the connected services we provide. By creating an account or using Docket, you
        accept the terms that apply to you. If you use Docket for an organization, you must have
        authority to agree on its behalf.
      </p>
    ),
  },
  {
    title: 'Eligibility',
    body: (
      <p>
        You must be at least 16 to create a hosted Docket account. If you are not legally an adult
        where you live, a parent or legal guardian must agree when the law requires it. Purchases
        must be made by an adult or someone authorized to buy for an organization. You must follow
        the law when using Docket.
      </p>
    ),
  },
  {
    title: 'Accounts',
    body: (
      <p>
        Keep your contact details current and protect your passkeys and recovery codes. You are
        responsible for activity under your account. Connect only accounts and organizations you are
        allowed to access. Other services have their own terms. You can disconnect services in
        Settings, but removing an account used to sign in may first require you to disconnect
        related services and keep another way to sign in.
      </p>
    ),
  },
  {
    title: 'Your content',
    body: (
      <p>
        You keep ownership of your content. You give Hypertext Studio a limited license to host,
        process, reproduce, and transmit it only to operate, secure, support, and provide the
        features you request. This does not give us a general right to use your content to improve
        products or train models. You must have the rights needed to share the content and authorize
        actions in connected services.
      </p>
    ),
  },
  {
    title: 'Product features',
    body: (
      <>
        <p>
          A personal workspace is free and includes planning, scheduling, and time tracking. Docket
          Pro adds shared work, connected services, Athena features, and connections for compatible
          AI tools. The product describes the available features and what you need to connect.
        </p>
        <p>
          Athena sends requests and relevant context to AI providers, or to a Lattice service you
          connect. Its suggestions can be incomplete or wrong. Review suggestions and important
          actions before relying on them, and choose permissions and approvals for work you
          delegate.
        </p>
        <p>
          Workspace permissions control who can see or manage shared work. Work you add to an
          organization may stay there after you leave. Your personal Athena conversations are
          separate from Athena sessions and records used for shared work. The Privacy Policy
          explains who can access this information.
        </p>
      </>
    ),
  },
  {
    title: 'Billing and refunds',
    body: (
      <>
        <p>
          Docket Pro costs USD $8 per organization each month, plus any required tax. Checkout shows
          the price, billing interval, and first charge date. Only an authorized workspace
          administrator may buy or manage the subscription.
        </p>
        <p>
          An eligible organization may receive one 14-day trial, which requires a payment method.
          Starting checkout again does not give another trial. Unless an authorized administrator
          cancels before the trial ends, monthly billing starts on the date shown at Checkout and
          continues until canceled.
        </p>
        <p>
          Canceling keeps Pro available until the paid period ends, as shown in Billing settings.
          After that date, shared work becomes read-only. You can export or reactivate while the
          workspace is available. Docket does not delete workspace data when Pro ends. Deleting your
          account in Settings is a separate action.
        </p>
        <p>
          If a payment fails, Pro stays available until the seven-day recovery deadline shown in
          Billing settings. Shared work becomes read-only if the payment is still unpaid after that
          deadline.
        </p>
        <p>
          Student, nonprofit, and private partner discounts need approval. They cannot be combined
          and may end on their stated review or expiration date. Docket shows the discount that will
          apply before the next charge.
        </p>
        <p>
          Direct purchases, including unused subscription time, are non-refundable except for
          billing errors or where the law requires a refund, withdrawal right, or other remedy.
          Canceling stops future renewals; it does not refund a charge. Contact product support
          about a billing error. Nothing in these terms limits mandatory consumer rights.
        </p>
      </>
    ),
  },
  {
    title: 'Acceptable use',
    body: (
      <p>
        Do not use Docket to break the law, infringe rights, access accounts without permission,
        distribute malware, bypass security controls, disrupt the service, scrape it at unreasonable
        volume, or share another person&apos;s confidential information without permission.
      </p>
    ),
  },
  {
    title: 'Changes and termination',
    body: (
      <>
        <p>
          We may change, suspend, or discontinue features and will make reasonable efforts to give
          notice of material changes. You can stop using Docket and request account deletion. We may
          suspend access because of security risks, legal requirements, unpaid bills, or material
          violations of these terms. The product and Privacy Policy explain available exports and
          recovery periods.
        </p>
        <p>
          These terms apply to new users when they create an account. Existing users receive 30
          days&apos; notice before they apply, on the date shown above. Until then, the prior terms
          continue to apply. Changes do not take away rights or remedies for earlier events. We will
          give at least 30 days&apos; notice before future material changes apply, unless the law or
          urgent security needs require an earlier change, which we will explain. We will give any
          additional notice or obtain any consent required by law. You can read prior versions
          through the history link above.
        </p>
      </>
    ),
  },
  {
    title: 'Warranties and liability',
    body: (
      <>
        <p>
          Docket is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis where
          the law allows. We do not guarantee uninterrupted service or complete, current information
          from connected services. Keep your own records and backups for critical work.
        </p>
        <p>
          To the maximum extent permitted by law, Hypertext Studio is not liable for indirect,
          incidental, special, consequential, or punitive damages, or for lost profits, revenues,
          data, or goodwill arising from use of Docket.
        </p>
        <p>
          Nothing in these terms limits liability, statutory warranties, remedies, or consumer
          protections that the law does not allow us to limit or exclude.
        </p>
      </>
    ),
  },
  {
    title: 'Governing law',
    body: (
      <p>
        Nevada law governs these terms, subject to the mandatory protections of the law where you
        live. Disputes may be brought in the state or federal courts in Clark County, Nevada, unless
        the law gives you a right to bring a claim in your home forum or requires another court. You
        keep those mandatory protections and home-forum rights.
      </p>
    ),
  },
  { title: 'Contact', body: <LegalPolicyContact /> },
];

/** Public Docket terms with prospective dates for existing users. */
export default function TermsPage(): JSX.Element {
  return (
    <LegalPolicyDocument
      title="Terms of service"
      dates={
        <>
          <p>Published October 14, 2026.</p>
          <p>
            Effective for existing users November 13, 2026; for new users when they create an
            account.
          </p>
        </>
      }
      sections={sections}
    />
  );
}
