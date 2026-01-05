'use client';

import { Plus, Calendar, FolderPlus, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface QuickAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}

const actions: QuickAction[] = [
  { label: 'New Task', icon: Plus, href: '/tasks/new' },
  { label: 'New Event', icon: Calendar, href: '/calendar/new' },
  { label: 'New Project', icon: FolderPlus, href: '/projects/new' },
  { label: 'New Initiative', icon: Target, href: '/initiatives/new' },
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
              variant="outline"
              className="h-auto flex-col gap-2 py-4"
              asChild
            >
              <a href={action.href}>
                <action.icon className="h-5 w-5" />
                <span className="text-sm">{action.label}</span>
              </a>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
