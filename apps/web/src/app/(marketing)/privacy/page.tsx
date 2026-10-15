import type { Metadata } from 'next';
import type { JSX } from 'react';

import {
  LegalPolicyContact,
  LegalPolicyDocument,
  type LegalPolicySection,
} from '@/components/marketing/legal-policy-document';

/** Privacy-policy metadata. */
export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How Docket processes account, workspace, AI, and connected-service data.',
};

const sections: readonly LegalPolicySection[] = [
  {
    title: 'Operator and scope',
    body: (
      <p>
        Hypertext Studio provides Docket, Docket Pro, and Athena. This policy explains how we handle
        personal information in those services, our website, and support. Organizations also decide
        what their members put in shared workspaces and how they use it. Contact your organization
        about its own practices as well as contacting us.
      </p>
    ),
  },
  {
    title: 'Data and purposes',
    body: (
      <>
        <p>
          We collect account and contact details, sign-in information, workspace membership and
          permissions, your work and files, planning and time records, preferences, support
          messages, and logs that help us run and protect Docket. We use this information to sign
          you in, provide requested features, sync connected services, manage subscriptions,
          communicate with you, prevent abuse, and handle support and legal requests. We do not
          store passkey private keys or full card details. Stripe processes payments.
        </p>
        <p>
          Where the law requires a legal basis, we use information to fulfill our agreement with
          you, including your account, purchases, and requested features; for our legitimate
          interests in security, abuse prevention, and support, balanced against your rights; and to
          meet legal recordkeeping obligations. We rely on consent where required for optional or
          sensitive processing and will not start that processing until valid consent is given. You
          can withdraw consent without affecting earlier lawful processing.
        </p>
        <p>
          Connecting another service gives Docket permission to access the information needed for
          that feature. We store encrypted connection credentials and information needed to sync
          your work. Google Calendar supports viewing and editing events, and Google Tasks supports
          syncing tasks both ways. Google Drive access is read-only for finding and attaching files.
          Gmail access lets Docket read relevant message details and content and make mailbox
          changes you request. We ask for permissions as needed.
        </p>
        <p>
          If you enable device notification syncing, Docket receives the notification text, app or
          source, and message details you choose to share. Optional location features use saved
          places, selected addresses, and location information as explained below.
        </p>
      </>
    ),
  },
  {
    title: 'Local and hosted processing',
    body: (
      <>
        <p>
          Docket stores account information, shared work, connected-service data, and Athena
          conversations on our servers. Your browser also keeps sign-in cookies and cached
          information. Browser caching does not make Docket local-only or end-to-end encrypted.
        </p>
        <p>
          Your browser can check whether you are at one of your saved places. For this check, Docket
          receives the matched place and location accuracy, rather than your precise browser
          position. Address searches send the text you type to Mapbox. Docket does not save
          temporary suggestions. Choosing an address or a point on the map stores the selected
          address and coordinates.
        </p>
      </>
    ),
  },
  {
    title: 'Recipients and AI',
    body: (
      <>
        <p>
          People and agents can see shared work according to workspace permissions. Owners and
          administrators manage membership and access, but joining an organization does not give
          them access to all your personal records or your personal Athena conversations. Athena
          sessions used for shared work, and records it adds to a workspace, follow workspace
          permissions. Leaving an organization removes your access; it does not automatically erase
          its work history.
        </p>
        <p>
          We use service providers to host and store information, protect Docket, process payments,
          send service emails, and provide maps. These include Google Cloud, Neon, Vercel,
          Cloudflare, Stripe, Resend, and Mapbox. Information also goes to services you connect when
          you use their features. Authorized Hypertext Studio operators may access hosted
          information for support, security, and running the service. We may disclose information
          when legally required or needed to protect people and the service.
        </p>
        <p>
          When you use Athena or another AI feature, the provider receives your request and the
          context needed to answer it. This can include instructions, relevant conversation history,
          selected information from your work, results from connected tools, and generated
          responses. Docket keeps conversations and activity so you can resume and review work.
          Hosted Athena currently uses Google Vertex AI. If you connect a Lattice service, requests
          and context go to that service and the providers it uses.
        </p>
        <p>
          Google processes hosted Athena requests under the terms that apply to our Vertex AI
          service and may retain requests and responses for service operation and abuse prevention.
          See Google&apos;s{' '}
          <a
            className="text-ink underline"
            href="https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance"
          >
            data-use and retention information
          </a>
          . If you connect a Lattice service, its operator and the providers it uses have their own
          data-use and retention terms. Disconnecting does not recall information already sent.
        </p>
        <p>
          We do not sell Google user data, use it for advertising, give it to data brokers, or use
          it to train generalized AI models. We use it only for the user-facing features you
          initiate, following the Google API Services User Data Policy and its Limited Use
          requirements. Storing a conversation so you can use it later is different from training a
          model.
        </p>
      </>
    ),
  },
  {
    title: 'Retention and deletion',
    body: (
      <>
        <p>
          We keep account, work, and conversation data while needed to provide Docket and the
          history you request. Canceling Pro does not delete workspace data. Disconnecting a service
          stops future access, but information already copied into shared work may remain in its
          history.
        </p>
        <p>
          Removing an account used to sign in is separate from disconnecting a workspace service.
          You may first need to disconnect services linked to that account and keep another way to
          sign in. We may ask you to verify your identity again. Removing the sign-in account
          removes its stored credentials from Docket. You can also revoke access in the other
          provider&apos;s settings. Revoking access does not automatically delete existing Docket
          records or copies held by that provider.
        </p>
        <p>
          Account deletion has a 14-day recovery period, during which you can cancel your request.
          If you are the only active owner of an organization with other members, we may be unable
          to start or finish deletion until you transfer ownership or delete that organization.
          After the recovery period, we delete your account, personal records, and workspaces used
          only by you. Shared organization records may remain available to other members. Export
          what you need before deleting your account.
        </p>
        <p>
          We keep six hours of recent database history for recovery. This is separate from the
          14-day account recovery period.
        </p>
        <p>
          Some information may also remain in separate copies that do not expire automatically and
          stay until manually removed. Deleting information from your account does not automatically
          remove it from those copies. When you request deletion, we also review these separate
          copies and remove matching information unless the law allows or requires us to keep it.
        </p>
        <p>
          Billing, security, legal, and backup records may remain for as long as needed for their
          purpose or required by law. Retention periods for backups and logs vary, and deleting an
          account does not immediately delete every backup or a recipient&apos;s copy. Synced device
          notifications follow the retention setting for that device; changing it affects future
          uploads.
        </p>
      </>
    ),
  },
  {
    title: 'Security',
    body: (
      <p>
        We limit access to hosted information, encrypt stored connection credentials, and monitor
        for suspicious activity. These measures reduce risk but cannot guarantee complete security.
        Protect your sign-in methods, review workspace and connection permissions, and contact us if
        you suspect unauthorized access.
      </p>
    ),
  },
  {
    title: 'Choices and rights',
    body: (
      <>
        <p>
          In Settings, you can manage your profile, sign-in methods, connected services,
          notifications, optional location and device notification features, exports, and account
          deletion. Workspace administrators manage organization access and shared records. Contact
          us if a control does not resolve your request or your organization prevents a change.
        </p>
        <p>
          Depending on where you live and the law that applies, you may have rights to access,
          correct, export, restrict, object to, or delete your information; withdraw consent; or
          complain to a data-protection regulator. We may verify your identity and authority before
          acting. We will follow the response periods required by law and explain any lawful limit
          on your request.
        </p>
      </>
    ),
  },
  {
    title: 'Children',
    body: (
      <p>
        Hosted Docket accounts are for people aged 16 and older. We do not knowingly collect account
        information from children under 16. Contact us if you believe a child under 16 has given us
        personal information so we can investigate and address it. A parent or guardian must agree
        to a minor&apos;s use when the law requires it.
      </p>
    ),
  },
  {
    title: 'International processing',
    body: (
      <p>
        Hypertext Studio is based in the United States. We and our providers may process information
        in the United States and other countries where we operate. Their protections may differ from
        those where you live. International transfers must meet applicable legal requirements.
        Contact us to ask about safeguards for a particular transfer.
      </p>
    ),
  },
  {
    title: 'Changes and contact',
    body: (
      <>
        <p>
          We will update this page when our practices materially change and give additional notice
          or obtain consent when required. This policy does not allow us to use past information for
          new purposes retroactively. You can read prior versions through the history link above.
        </p>
        <LegalPolicyContact />
      </>
    ),
  },
];

/** Public privacy policy covering hosted, shared, connected, and AI processing. */
export default function PrivacyPage(): JSX.Element {
  return (
    <LegalPolicyDocument
      title="Privacy policy"
      dates={<p>Published and effective October 14, 2026.</p>}
      sections={sections}
    />
  );
}
