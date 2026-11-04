import { TooltipProvider } from '@docket/ui/primitives';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

/** Render a planning surface with the tooltip timing context supplied by the application. */
export function renderPlanning(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: TooltipProvider });
}
