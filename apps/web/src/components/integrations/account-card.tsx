'use client';

/**
 * Account card component for multi-account calendar integrations.
 *
 * Displays account info, sync status, and calendar selection.
 * Includes overflow menu for account management (rename, set primary, disconnect).
 */

import { useState } from 'react';
import StarOutlinedIcon from '@mui/icons-material/StarOutlined';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined';
import type { CalendarConnection } from '@/lib/api-client';
import { Surface } from '@/components/ui/surface';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CalendarSelection } from './calendar-selection';

interface AccountCardProps {
  connection: CalendarConnection;
  onSync: () => void;
  onDisconnect: () => void;
  onRename: () => void;
  onSetPrimary: () => void;
  onCalendarUpdate: () => void;
  isSyncing?: boolean;
  isDisconnecting?: boolean;
}

/**
 * Account card for a connected calendar account.
 * Shows account email/label, sync status, and calendar toggles.
 */
export function AccountCard({
  connection,
  onSync,
  onDisconnect,
  onRename,
  onSetPrimary,
  onCalendarUpdate,
  isSyncing = false,
  isDisconnecting = false,
}: AccountCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const displayName = connection.accountLabel ?? connection.accountEmail ?? 'Connected Account';
  const hasEmail = connection.accountEmail && connection.accountLabel !== connection.accountEmail;

  const handleDisconnect = () => {
    if (!confirm(`Are you sure you want to disconnect ${displayName}?`)) {
      return;
    }
    onDisconnect();
  };

  return (
    <Surface elevation="high" padding="md" rounded="md" className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Account color indicator */}
            {connection.accountColor && (
              <div
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: connection.accountColor }}
              />
            )}
            <span className="text-on-surface truncate font-medium">{displayName}</span>
            {connection.isPrimary && (
              <StarOutlinedIcon sx={{ fontSize: 16 }} className="text-primary shrink-0" />
            )}
          </div>
          {hasEmail && (
            <p className="text-on-surface-variant mt-0.5 truncate text-sm">
              {connection.accountEmail}
            </p>
          )}
          {/* Sync status */}
          {connection.lastSyncAt && (
            <p className="text-on-surface-variant mt-1 text-xs">
              Last synced:{' '}
              {new Date(connection.lastSyncAt).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
              {connection.lastSyncStatus === 'error' && (
                <span className="text-error ml-1">(sync failed)</span>
              )}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="text"
            size="sm"
            onClick={onSync}
            disabled={isSyncing}
            className="h-8 w-8 p-0"
          >
            <SyncOutlinedIcon sx={{ fontSize: 18 }} className={isSyncing ? 'animate-spin' : ''} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="text" size="sm" className="h-8 w-8 p-0">
                <MoreVertIcon sx={{ fontSize: 18 }} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRename}>
                <EditOutlinedIcon sx={{ fontSize: 16 }} className="mr-2" />
                Rename
              </DropdownMenuItem>
              {!connection.isPrimary && (
                <DropdownMenuItem onClick={onSetPrimary}>
                  <StarBorderOutlinedIcon sx={{ fontSize: 16 }} className="mr-2" />
                  Set as Primary
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="text-error focus:text-error"
              >
                <LinkOffOutlinedIcon sx={{ fontSize: 16 }} className="mr-2" />
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Calendar Selection (expandable) */}
      {connection.calendars.length > 0 && (
        <div className="border-outline-variant/50 border-t pt-3">
          <button
            type="button"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            className="text-on-surface-variant hover:text-on-surface mb-2 flex w-full items-center justify-between text-sm font-medium transition-colors"
          >
            <span>Calendars ({connection.calendars.length})</span>
            <span className="text-xs">{isExpanded ? 'Hide' : 'Show'}</span>
          </button>
          {isExpanded && (
            <CalendarSelection
              connectionId={connection.id}
              calendars={connection.calendars}
              onUpdate={onCalendarUpdate}
            />
          )}
        </div>
      )}
    </Surface>
  );
}
