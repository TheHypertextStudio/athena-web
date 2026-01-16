'use client';

import AddOutlined from '@mui/icons-material/AddOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import CreateNewFolderOutlined from '@mui/icons-material/CreateNewFolderOutlined';
import GpsFixedOutlined from '@mui/icons-material/GpsFixedOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface QuickAction {
  label: string;
  icon: SvgIconComponent;
  href: string;
}

const actions: QuickAction[] = [
  { label: 'New Task', icon: AddOutlined, href: '/tasks/new' },
  { label: 'New Event', icon: CalendarTodayOutlined, href: '/calendar/new' },
  { label: 'New Project', icon: CreateNewFolderOutlined, href: '/projects/new' },
  { label: 'New Initiative', icon: GpsFixedOutlined, href: '/initiatives/new' },
];

export function QuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="outlined"
              className="h-auto flex-col gap-2 py-4"
              asChild
            >
              <a href={action.href}>
                <action.icon sx={{ fontSize: 20 }} />
                <span className="text-sm">{action.label}</span>
              </a>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
