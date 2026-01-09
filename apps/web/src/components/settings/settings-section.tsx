import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Applies destructive styling for danger zones */
  variant?: 'default' | 'destructive';
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
}: SettingsSectionProps) {
  return (
    <section
      className={cn(
        'bg-surface-container rounded-2xl p-6',
        variant === 'destructive' && 'border-error/50 border',
        className,
      )}
    >
      <div className="mb-4">
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
      <div>{children}</div>
    </section>
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
 */
export function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  return (
    <div className={cn('flex items-center justify-between py-4', className)}>
      <div className="space-y-0.5">
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
    <div
      className={cn(
        'bg-surface-container-high flex items-center justify-between rounded-xl p-4',
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <div className="bg-surface-container-highest text-on-surface-variant flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-on-surface font-medium">{title}</span>
            {badge}
          </div>
          {description && <p className="text-on-surface-variant text-sm">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
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
    <div className={cn('flex items-center justify-between py-4', className)}>
      <div className="flex items-center gap-3">
        {icon && <div className="text-on-surface-variant">{icon}</div>}
        <div className="space-y-0.5">
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
    warning: 'bg-tertiary-container/30 border-tertiary/50',
    error: 'bg-error-container/30 border-error/50',
    info: 'bg-secondary-container/30 border-secondary/50',
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
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4',
        variantStyles[variant],
        className,
      )}
    >
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
