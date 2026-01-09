/**
 * Full page route for integration detail.
 *
 * This route is matched when accessing the URL directly or after refresh,
 * displaying the detail content as a full page with back navigation.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import { getIntegrationConfig } from '@/lib/integrations';
import { IntegrationDetailContent } from '@/components/integrations';

export default async function IntegrationDetailPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  const config = getIntegrationConfig(provider);

  if (!config) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <Link
        href="/settings/integrations"
        className="text-on-surface-variant hover:text-on-surface inline-flex items-center gap-2 text-sm transition-colors"
      >
        <ArrowBackOutlinedIcon sx={{ fontSize: 18 }} />
        Back to Integrations
      </Link>
      <div className="border-outline-variant bg-surface-container-lowest rounded-xl border p-6">
        <IntegrationDetailContent provider={provider} />
      </div>
    </div>
  );
}
