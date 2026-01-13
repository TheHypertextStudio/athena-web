import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import PhoneAndroidOutlinedIcon from '@mui/icons-material/PhoneAndroidOutlined';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import { getSessions, type Session } from '@/lib/security-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import {
  SettingsSection,
  SettingsItemCard,
  SectionError,
} from '@/components/settings/settings-section';
import { Badge } from '@/components/ui/badge';
import { RevokeSessionButton, RevokeAllSessionsButton } from './sessions-actions';

function getDeviceIcon(userAgent: string | null) {
  if (!userAgent) return PublicOutlinedIcon;
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return PhoneAndroidOutlinedIcon;
  }
  return ComputerOutlinedIcon;
}

function parseUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const ua = userAgent.toLowerCase();
  let browser = 'Unknown browser';
  let os = 'Unknown OS';

  if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('safari')) browser = 'Safari';
  else if (ua.includes('edge')) browser = 'Edge';

  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  return `${browser} on ${os}`;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`;
  if (diffHours < 24) return `${String(diffHours)}h ago`;
  if (diffDays < 7) return `${String(diffDays)}d ago`;

  return date.toLocaleDateString();
}

export async function ActiveSessionsSection() {
  let sessions: Session[] = [];
  let errorCode: ApiErrorCode | null = null;

  try {
    const result = await getSessions();
    sessions = result.sessions;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode) {
    return (
      <SettingsSection
        title="Active Sessions"
        description="Devices where you're currently signed in."
      >
        <SectionError code={errorCode} />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Active Sessions"
      description="Devices where you're currently signed in."
    >
      <div className="space-y-3">
        {sessions.map((session) => {
          const DeviceIcon = getDeviceIcon(session.userAgent);
          return (
            <SettingsItemCard
              key={session.id}
              icon={<DeviceIcon sx={{ fontSize: 20 }} />}
              title={parseUserAgent(session.userAgent)}
              description={`${session.ipAddress ?? 'Unknown IP'} • ${formatRelativeTime(session.lastActiveAt)}`}
              badge={session.isCurrent ? <Badge variant="secondary">Current</Badge> : undefined}
              action={
                !session.isCurrent ? <RevokeSessionButton sessionId={session.id} /> : undefined
              }
            />
          );
        })}
        {sessions.length > 1 && <RevokeAllSessionsButton />}
      </div>
    </SettingsSection>
  );
}
