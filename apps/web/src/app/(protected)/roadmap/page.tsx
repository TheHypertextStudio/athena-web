'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import FilterListIcon from '@mui/icons-material/FilterList';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProjectRoadmapFlow } from '@/components/flows';
import { signOut } from '@/lib/auth-client';
import { useQuery } from '@tanstack/react-query';
import { initiativesApi } from '@/lib/api-client';

export default function RoadmapPage() {
  const router = useRouter();
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [selectedInitiative, setSelectedInitiative] = useState<string | undefined>(undefined);

  const { data: initiativesData } = useQuery({
    queryKey: ['initiatives'],
    queryFn: () => initiativesApi.list(),
  });

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  const handleNodeClick = (nodeId: string, nodeType: 'initiative' | 'project') => {
    if (nodeType === 'initiative') {
      setSelectedInitiative(nodeId);
    } else {
      router.push(`/projects/${nodeId}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Header title="Roadmap" onSignOut={() => void handleSignOut()} />

      <div className="border-outline-variant flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outlined" size="sm">
                <FilterListIcon sx={{ fontSize: 18 }} className="mr-2" />
                {selectedInitiative
                  ? (initiativesData?.data.find((i) => i.id === selectedInitiative)?.name ??
                    'Filter')
                  : 'All Initiatives'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Filter by Initiative</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setSelectedInitiative(undefined);
                }}
              >
                All Initiatives
              </DropdownMenuItem>
              {initiativesData?.data.map((initiative) => (
                <DropdownMenuItem
                  key={initiative.id}
                  onClick={() => {
                    setSelectedInitiative(initiative.id);
                  }}
                >
                  {initiative.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outlined"
            size="sm"
            onClick={() => {
              setIncludeCompleted(!includeCompleted);
            }}
          >
            {includeCompleted ? (
              <>
                <VisibilityOffIcon sx={{ fontSize: 18 }} className="mr-2" />
                Hide Completed
              </>
            ) : (
              <>
                <VisibilityIcon sx={{ fontSize: 18 }} className="mr-2" />
                Show Completed
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 p-6">
        <ProjectRoadmapFlow
          initiativeId={selectedInitiative}
          title={
            selectedInitiative
              ? (initiativesData?.data.find((i) => i.id === selectedInitiative)?.name ?? 'Roadmap')
              : 'All Initiatives'
          }
          onNodeClick={handleNodeClick}
          includeCompleted={includeCompleted}
          className="h-full min-h-[500px]"
        />
      </div>
    </div>
  );
}
