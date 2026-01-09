/**
 * Icon mapping for integration providers.
 *
 * Uses MUI icons as representations for each provider.
 * These are semantic icons based on service type rather than brand logos.
 */

import ViewKanbanOutlinedIcon from '@mui/icons-material/ViewKanbanOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import EventOutlinedIcon from '@mui/icons-material/EventOutlined';
import AppleIcon from '@mui/icons-material/Apple';
import ChatOutlinedIcon from '@mui/icons-material/ChatOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import BrushOutlinedIcon from '@mui/icons-material/BrushOutlined';
import type { IntegrationProvider } from '@/lib/integrations';

interface IconProps {
  size?: number;
  className?: string;
}

type IconComponent = React.FC<IconProps>;

/**
 * Get the icon component for a specific provider.
 */
export function getProviderIcon(provider: IntegrationProvider): IconComponent {
  const iconMap: Record<IntegrationProvider, IconComponent> = {
    linear: ({ size = 20, className }) => (
      <ViewKanbanOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    github: ({ size = 20, className }) => (
      <CodeOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    todoist: ({ size = 20, className }) => (
      <ChecklistOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    asana: ({ size = 20, className }) => (
      <AssignmentOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    jira: ({ size = 20, className }) => (
      <BugReportOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    trello: ({ size = 20, className }) => (
      <DashboardOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    google_calendar: ({ size = 20, className }) => (
      <CalendarTodayOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    outlook_calendar: ({ size = 20, className }) => (
      <EventOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    apple_calendar: ({ size = 20, className }) => (
      <AppleIcon sx={{ fontSize: size }} className={className} />
    ),
    slack: ({ size = 20, className }) => (
      <ChatOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    zoom: ({ size = 20, className }) => (
      <VideocamOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    google_drive: ({ size = 20, className }) => (
      <FolderOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    dropbox: ({ size = 20, className }) => (
      <CloudOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
    figma: ({ size = 20, className }) => (
      <BrushOutlinedIcon sx={{ fontSize: size }} className={className} />
    ),
  };

  return iconMap[provider];
}

/**
 * Component wrapper for provider icons.
 */
export function IntegrationIcon({
  provider,
  size = 20,
  className,
}: {
  provider: IntegrationProvider;
  size?: number;
  className?: string;
}) {
  const Icon = getProviderIcon(provider);
  return <Icon size={size} className={className} />;
}
