import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import type { ApiErrorCode } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { Surface, SurfaceContainer } from '@/components/ui/surface';

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Applies destructive styling for danger zones */
  variant?: 'default' | 'destructive';
  /** Optional action element to display in the header (e.g., toggle, button) */
  headerAction?: React.ReactNode;
}

/**
 * Reusable settings section with MD3 surface container styling.
 */
export function SettingsSection({
  title,
  description,
  children,
  className,
  variant = 'default',
  headerAction,
}: SettingsSectionProps) {
  return (
    <SurfaceContainer
      as="section"
      rounded="lg"
      className={cn(variant === 'destructive' && 'bg-error-container/20', className)}
    >
      <div className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              className={cn(
                'text-on-surface text-lg font-medium',
                variant === 'destructive' && 'text-error',
              )}
            >
              {title}
            </h2>
            {description && <p className="text-on-surface-variant mt-1 text-sm">{description}</p>}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      </div>
      <div>{children}</div>
    </SurfaceContainer>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A single row within a settings section, with label on left and control on right.
 * On very small screens, stacks vertically for better usability.
 */
export function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="text-on-surface text-sm font-medium">{label}</div>
        {description && <div className="text-on-surface-variant text-xs">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

interface SettingsItemCardProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * A card-style item within a settings section (accounts, sessions, integrations, etc.).
 * Responsive: stacks vertically on very small screens.
 */
export function SettingsItemCard({
  icon,
  title,
  description,
  badge,
  action,
  className,
}: SettingsItemCardProps) {
  return (
    <Surface
      elevation="high"
      padding="md"
      rounded="md"
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        className,
      )}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <Surface
          elevation="highest"
          padding="none"
          rounded="sm"
          className="text-on-surface-variant flex h-10 w-10 shrink-0 items-center justify-center"
        >
          {icon}
        </Surface>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-on-surface font-medium">{title}</span>
            {badge}
          </div>
          {description && (
            <p className="text-on-surface-variant text-sm break-words">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0 self-end sm:self-center">{action}</div>}
    </Surface>
  );
}

interface SettingsToggleRowProps {
  icon?: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A toggle row with optional icon for notification-style settings.
 * Responsive: keeps horizontal layout but allows text to wrap.
 */
export function SettingsToggleRow({
  icon,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SettingsToggleRowProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-4 sm:items-center', className)}>
      <div className="flex min-w-0 items-start gap-3 sm:items-center">
        {icon && <div className="text-on-surface-variant mt-0.5 shrink-0 sm:mt-0">{icon}</div>}
        <div className="min-w-0 space-y-0.5">
          <div className="text-on-surface text-sm font-medium">{label}</div>
          {description && <div className="text-on-surface-variant text-xs">{description}</div>}
        </div>
      </div>
      <div className="shrink-0">
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              onCheckedChange(e.target.checked);
            }}
            disabled={disabled}
            className="peer sr-only"
          />
          <div className="peer bg-outline-variant after:bg-surface peer-checked:bg-primary peer-checked:after:bg-on-primary peer-focus-visible:ring-primary h-6 w-11 rounded-full peer-focus-visible:ring-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full" />
        </label>
      </div>
    </div>
  );
}

interface SettingsAlertBannerProps {
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  variant?: 'warning' | 'error' | 'info';
  className?: string;
}

/**
 * An alert banner for important messages within settings (warnings, danger zones, etc.).
 */
export function SettingsAlertBanner({
  icon,
  title,
  children,
  variant = 'warning',
  className,
}: SettingsAlertBannerProps) {
  const variantStyles = {
    warning: 'bg-tertiary-container/30',
    error: 'bg-error-container/30',
    info: 'bg-secondary-container/30',
  };

  const iconStyles = {
    warning: 'text-tertiary',
    error: 'text-error',
    info: 'text-secondary',
  };

  const titleStyles = {
    warning: 'text-on-tertiary-container',
    error: 'text-error',
    info: 'text-on-secondary-container',
  };

  return (
    <div className={cn('flex items-start gap-3 rounded-xl p-4', variantStyles[variant], className)}>
      {icon && <div className={cn('mt-0.5 shrink-0', iconStyles[variant])}>{icon}</div>}
      <div className="space-y-1">
        {title && <p className={cn('text-sm font-medium', titleStyles[variant])}>{title}</p>}
        <div className="text-on-surface-variant text-sm">{children}</div>
      </div>
    </div>
  );
}

interface SettingsEmptyStateProps {
  message: string;
  className?: string;
}

/**
 * Empty state message for settings lists.
 */
export function SettingsEmptyState({ message, className }: SettingsEmptyStateProps) {
  return (
    <p className={cn('text-on-surface-variant py-4 text-center text-sm', className)}>{message}</p>
  );
}

const ERROR_MESSAGES: Record<ApiErrorCode, { title: string; description: string }> = {
  rate_limited: {
    title: 'Too many requests',
    description: 'Please wait a moment and try again.',
  },
  unauthorized: {
    title: 'Session expired',
    description: 'Please sign in again.',
  },
  server_error: {
    title: 'Server error',
    description: 'Something went wrong. Please try again later.',
  },
  network_error: {
    title: 'Connection failed',
    description: 'Check your internet connection.',
  },
  bad_request: {
    title: 'Invalid request',
    description: 'The request could not be processed.',
  },
  not_found: {
    title: 'Not found',
    description: 'The requested resource was not found.',
  },
  forbidden: {
    title: 'Access denied',
    description: 'You do not have permission to access this resource.',
  },
  entitlement_required: {
    title: 'Upgrade required',
    description: 'This feature requires a higher subscription tier.',
  },
  unknown: {
    title: 'Unable to load',
    description: 'Please try again later.',
  },
};

interface SectionErrorProps {
  code: ApiErrorCode;
  className?: string;
}

/**
 * Inline error display for settings sections when API calls fail.
 */
export function SectionError({ code, className }: SectionErrorProps) {
  const { title, description } = ERROR_MESSAGES[code];

  return (
    <div className={cn('bg-error-container/30 flex items-center gap-3 rounded-xl p-4', className)}>
      <div className="text-error shrink-0">
        <ErrorOutlineOutlinedIcon sx={{ fontSize: 20 }} />
      </div>
      <div>
        <p className="text-error text-sm font-medium">{title}</p>
        <p className="text-on-surface-variant text-sm">{description}</p>
      </div>
    </div>
  );
}
