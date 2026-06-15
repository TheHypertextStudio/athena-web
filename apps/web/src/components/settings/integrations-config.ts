import type { IntegrationOut } from '@docket/types';
import {
  Calendar,
  Folder,
  Github,
  Layers,
  type LucideIcon,
  Mail,
  Sparkles,
  TaskAlt,
} from '@docket/ui/icons';

/** PROVIDER_ICON maps integration providers to their display icon component. */
export const PROVIDER_ICON: Record<string, LucideIcon> = {
  github: Github,
  linear: Layers,
  drive: Folder,
  gmail: Mail,
  calendar: Calendar,
  gtasks: TaskAlt,
};

/** providerIcon returns the icon component for an integration provider. */
export function providerIcon(provider: string): LucideIcon {
  return PROVIDER_ICON[provider] ?? Sparkles;
}

/** CATEGORY_LABEL maps integration enum values to user-facing labels. */
export const CATEGORY_LABEL: Record<string, string> = {
  engineering: 'Engineering',
  'project-management': 'Project management',
  documents: 'Documents',
  communication: 'Communication',
};

/** STATUS_LABEL maps integration enum values to user-facing labels. */
export const STATUS_LABEL: Record<
  IntegrationOut['status'],
  { label: string; variant: 'secondary' | 'destructive' }
> = {
  connected: { label: 'Connected', variant: 'secondary' },
  error: { label: 'Needs attention', variant: 'destructive' },
  disconnected: { label: 'Disconnected', variant: 'secondary' },
};

/** categoryLabel returns display copy for an integration provider category. */
export function categoryLabel(category: string): string {
  return (
    CATEGORY_LABEL[category] ??
    category
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}
