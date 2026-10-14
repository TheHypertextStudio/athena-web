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
        These terms are an agreement between you and Hypertext Studio for Docket, including Docket
        Pro, Athena, and connected services we provide. By creating an account or using Docket, you
        accept the terms that apply to you. If you act for an organization, you must have authority
        to bind it.
      </p>
    ),
  },
  {
    title: 'Eligibility',
    body: (
      <p>
        You must be at least 16 to create a hosted Docket account. If you are below the age of
        adulthood where you live, a parent or legal guardian must agree to these terms when required
        for a valid agreement. Purchases must be made by an adult or someone authorized to buy for
        an organization. You must use Docket in compliance with applicable law.
      </p>
    ),
  },
  {
    title: 'Accounts',
    body: (
      <p>
        You are responsible for activity under your account, protecting your passkeys and recovery
        codes, and maintaining accurate contact information. Only connect accounts and organizations
        you are authorized to access. Third-party services remain governed by their own terms.
        Connection settings let you disconnect services; linked sign-in identities may require you
        to disconnect dependent workspace connections and preserve a way to sign in first.
      </p>
    ),
  },
  {
    title: 'Your content',
    body: (
      <p>
        You retain ownership of content you submit or synchronize. You grant Hypertext Studio a
        limited license to host, process, reproduce, and transmit that content only as needed to
        operate, secure, support, and deliver the features you request. This license does not give
        us a general right to use your content to improve products or train models. You must have
        the rights needed to provide the content and authorize requested connector actions.
      </p>
    ),
  },
  {
    title: 'Product features',
    body: (
      <>
        <p>
          Docket is available without charge for a personal workspace with planning, scheduling, and
          time tracking. Docket Pro adds shared work, integrations, MCP, and current Athena
          functionality. Available features and connection requirements are described in the
          product.
        </p>
        <p>
          Athena uses model providers or a Lattice instance you connect to process the requests and
          context needed for a feature. Generated suggestions may be incomplete or wrong. Review
          suggestions and consequential actions before relying on them, and configure permissions
          and approvals to suit the work you delegate.
        </p>
        <p>
          Workspace permissions determine who can see or manage shared work. Work you place in an
          organization may remain there after you leave. Personal Athena conversations are separate
          from workspace agent sessions and shared records. The Privacy Policy describes these
          distinctions and connected-service processing.
        </p>
      </>
    ),
  },
  {
    title: 'Billing and refunds',
    body: (
      <>
        <p>
          Docket Pro costs USD $8 per organization each month, plus tax where required. The price,
          billing interval, and first charge date are shown during Checkout. Only an authorized
          workspace administrator may purchase or manage the subscription.
        </p>
        <p>
          An eligible organization may receive one 14-day trial that requires a payment method.
          Starting checkout again does not add another trial. Unless an authorized workspace
          administrator cancels before the trial ends, Docket Pro begins monthly billing on the
          first charge date shown during Checkout. The subscription renews monthly until an
          authorized workspace administrator cancels it.
        </p>
        <p>
          Pro features remain available through the paid period end shown in Billing settings. After
          that date, shared work becomes read-only. You can export or reactivate while the workspace
          remains available. Docket does not delete workspace data when Pro ends. Confirmed account
          deletion through the Danger Zone in Settings is a separate action.
        </p>
        <p>
          If payment fails, Pro remains available through the seven-day recovery deadline shown in
          Billing settings. Shared work becomes read-only after that deadline if the payment remains
          unpaid.
        </p>
        <p>
          Student, nonprofit, and private partner discounts require approval. Discounts do not
          stack, and they may end on their stated review or expiration date. Docket shows the
          effective discount before the next charge.
        </p>
        <p>
          Direct purchases are non-refundable, including unused subscription time, except to correct
          billing errors or where applicable law requires a refund, withdrawal right, or other
          remedy. Canceling stops future renewals; it does not itself refund a charge. Contact
          product support about a billing error. Nothing in these terms limits mandatory consumer
          rights.
        </p>
      </>
    ),
  },
  {
    title: 'Acceptable use',
    body: (
      <p>
        Do not use Docket to break the law, infringe rights, access accounts without permission,
        distribute malware, evade security controls, interfere with the service, scrape it at
        unreasonable volume, or expose another person&apos;s confidential information without
        authorization.
      </p>
    ),
  },
  {
    title: 'Changes and termination',
    body: (
      <>
        <p>
          We may change, suspend, or discontinue features and will use reasonable efforts to give
          notice of material changes. You may stop using Docket and request account deletion. We may
          suspend access to address security risks, legal requirements, nonpayment, or material
          violations of these terms. Available export and recovery periods are described in the
          product and Privacy Policy.
        </p>
        <p>
          These terms are published October 14, 2026. They apply to new users when they create an
          account and to existing users on November 13, 2026, after 30 days&apos; notice. Until
          then, the prior terms continue to govern existing users. Changes apply prospectively and
          do not remove rights or remedies for earlier events. We will give advance notice of future
          material changes, and any notice or consent required by applicable law. Prior versions
          remain available through the history link above.
        </p>
      </>
    ),
  },
  {
    title: 'Warranties and liability',
    body: (
      <>
        <p>
          Docket is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis to the
          extent permitted by law. We do not guarantee uninterrupted operation or that synchronized
          data will always be complete or current. You should keep appropriate source-system records
          and backups for critical work.
        </p>
        <p>
          To the maximum extent permitted by law, Hypertext Studio is not liable for indirect,
          incidental, special, consequential, or punitive damages, or for lost profits, revenues,
          data, or goodwill arising from use of Docket.
        </p>
        <p>
          These provisions apply only where lawful. They do not limit liability or statutory
          warranties, remedies, or consumer protections that cannot lawfully be limited or excluded.
        </p>
      </>
    ),
  },
  {
    title: 'Governing law',
    body: (
      <p>
        Nevada law governs these terms, subject to mandatory protections under the law of your place
        of residence. Disputes may be brought in the state or federal courts located in Clark
        County, Nevada, unless applicable law gives you a right to bring a claim in your home forum
        or requires another court. Nothing here removes those mandatory protections or home-forum
        rights.
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
