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
        Hypertext Studio operates Docket, Docket Pro, and Athena. This policy describes our
        processing of personal information through those services, our website, and support.
        Organizations decide what work their members place in shared workspaces and how they use it;
        contact your organization about its own practices as well as contacting us.
      </p>
    ),
  },
  {
    title: 'Data and purposes',
    body: (
      <>
        <p>
          We process account profile and contact details, passkey public-key and session metadata,
          workspace membership and permissions, content and files you create or synchronize,
          planning and time records, settings, support communications, and technical and security
          logs. We use these to sign you in, provide your workspaces and requested features,
          synchronize connected services, process subscriptions, communicate about the service,
          prevent abuse, and respond to support and legal requests. We do not store passkey private
          keys or full payment-card details; Stripe processes payment information.
        </p>
        <p>
          When you authorize a connector, we process its account identifier, granted permissions,
          encrypted access and refresh tokens, synchronization state, and relevant provider data.
          Google Calendar access supports event display and requested editing; Tasks supports
          two-way task synchronization; Drive read-only access supports finding and attaching chosen
          files; Gmail modify access supports relevant message metadata and content and mailbox
          actions you request. Permissions are requested as the feature needs them.
        </p>
        <p>
          Optional device notification synchronization uploads the notification text, app/source
          information, and message details you choose to share, with the retention setting for that
          device. Optional location features use saved places, selected addresses, coordinates, and
          location-match information to provide the features you enable.
        </p>
      </>
    ),
  },
  {
    title: 'Local and hosted processing',
    body: (
      <>
        <p>
          Docket is a hosted service. Accounts, shared work, connector data, and Athena
          conversations are stored on our service infrastructure; necessary sign-in cookies, browser
          storage, and caches support local use and recovery. Local caching does not make hosted
          content end-to-end encrypted or available only to you.
        </p>
        <p>
          Routine automatic location matching compares your foreground browser position with saved
          places on your device. Docket receives the matched place identifier and accuracy, rather
          than the raw foreground position used for that matching. When you search for an address,
          Docket sends the typed search to Mapbox through our API. Temporary autocomplete results
          are not stored by Docket. Selecting a result or identifying a map point requests a
          permanent result and stores the selected address and coordinates.
        </p>
      </>
    ),
  },
  {
    title: 'Recipients and AI',
    body: (
      <>
        <p>
          Shared workspace records are visible to people and agents with the relevant permissions.
          Workspace owners and administrators manage membership and access; joining a workspace does
          not make every personal record visible to them. Personal Athena conversations are
          restricted to their account owner; registered workspace agent sessions and records that
          Athena writes into shared work follow workspace permissions. Leaving an organization
          removes access but does not automatically erase the organization&apos;s work history.
        </p>
        <p>
          Our infrastructure and service providers process information needed to host, store,
          secure, support, and deliver Docket. These include Google Cloud, Neon, Vercel, Cloudflare,
          Stripe for payments, Resend for service email, Mapbox for maps and address searches, and
          the external services you choose to connect. Authorized Studio operators can access hosted
          information as needed for support, security, and operation. We may disclose information
          when legally required or necessary to protect people and the service.
        </p>
        <p>
          When you use Athena or authorize an AI feature, prompts, relevant conversation history,
          instructions, selected context, tool results, and generated responses are processed to
          carry out that request. Docket retains conversation transcripts and activity so you can
          resume and review work. Docket&apos;s current hosted model backend uses Google Vertex AI.
          Supported configurations also include Anthropic and Cloudflare routing; if the backend
          changes, the provider receiving the request changes. If you connect your own Lattice
          instance, relevant requests and context go to that instance and the providers it uses.
          Your selected backend and its own provider terms determine that provider&apos;s
          processing; disconnecting it does not recall information already sent.
        </p>
        <p>
          We do not sell Google user data, use it for advertising, transfer it to data brokers, or
          use it to train generalized artificial-intelligence models. Google user data is used only
          for the user-facing features you initiate, in accordance with the Google API Services User
          Data Policy, including its Limited Use requirements. Operating or storing a conversation
          is different from model training. This policy does not promise that every third-party
          model path has zero retention or identical training rules; review the terms of any
          provider or Lattice instance you connect.
        </p>
      </>
    ),
  },
  {
    title: 'Retention and deletion',
    body: (
      <>
        <p>
          We retain account, work, and conversation data while needed to provide the service and
          requested history. Canceling Docket Pro does not delete workspace data. Disconnecting a
          connector stops its future authorized use, but organization records created from
          synchronized content may remain as work history.
        </p>
        <p>
          Unlinking an external sign-in identity is separate from disconnecting a workspace
          integration. If workspace connections depend on an identity, disconnect or rebind them
          first. You must also preserve a sign-in method and may need to verify your identity again.
          Unlinking removes the stored identity credentials. You can also revoke access through the
          provider&apos;s settings. Existing Docket records and copies held by the provider are not
          all deleted by revocation.
        </p>
        <p>
          Account deletion uses a 14-day recovery period during which you can cancel the request. If
          you are the only active owner of a shared organization, first transfer ownership or
          resolve that organization; this can block scheduling or final deletion. After the recovery
          period, the deletion process removes your account and associated personal records and
          solely occupied workspaces. Shared organization records may remain for other members and
          their work history. Export the data available to you before deletion.
        </p>
        <p>
          Security, legal, billing, and backup records may remain where needed for their purpose or
          a legal obligation. Backup and operational log retention depend on the systems involved;
          deletion from the active service does not promise immediate deletion from every backup or
          recipient. Optional synced device notifications follow their stored expiry dates; changing
          a device&apos;s retention applies to future uploads.
        </p>
      </>
    ),
  },
  {
    title: 'Security',
    body: (
      <p>
        We use access controls, encryption for stored connector credentials, workspace
        authorization, audit records, and operational monitoring to protect hosted information.
        Access and security controls reduce risk but cannot guarantee complete security. Protect
        your sign-in methods, review sharing and connection permissions, and contact us about
        suspected unauthorized access.
      </p>
    ),
  },
  {
    title: 'Choices and rights',
    body: (
      <>
        <p>
          You can manage profile details, sign-in methods, connected services, notification
          preferences, optional location and device notification features, exports, and deletion in
          Settings. Workspace administrators manage organization access and shared records. Contact
          us if a control does not resolve your request or organization obligations prevent a
          change.
        </p>
        <p>
          Depending on your location and applicable law, you may have rights to access, correct,
          export, restrict, object to, or delete personal information, withdraw consent where
          processing depends on it, or complain to a supervisory authority. We may verify your
          identity and authority before acting on a request. We will respect applicable response
          periods and explain any lawful limitation.
        </p>
      </>
    ),
  },
  {
    title: 'Children',
    body: (
      <p>
        Hosted Docket accounts are for people aged 16 and older. We do not knowingly collect account
        information from children under 16. If you believe a child under 16 has provided personal
        information, contact us so we can investigate and address it. A parent or guardian must
        agree where required for a minor&apos;s valid use.
      </p>
    ),
  },
  {
    title: 'International processing',
    body: (
      <p>
        Hypertext Studio is based in the United States. Docket and its providers may process
        information in the United States and other countries where they operate. Protections can
        differ from those where you live. International transfers are subject to applicable legal
        requirements. Contact us for information about the safeguards applicable to a particular
        transfer.
      </p>
    ),
  },
  {
    title: 'Changes and contact',
    body: (
      <>
        <p>
          Published and effective October 14, 2026. This policy explains current processing; it does
          not authorize retroactive use of information for new purposes. We will update this page
          when practices materially change and provide additional notice or obtain consent when
          required. Prior versions remain available through the history link above.
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
      dates={<p>Effective October 14, 2026.</p>}
      sections={sections}
    />
  );
}
