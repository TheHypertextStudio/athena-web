'use client';

import { useCallback } from 'react';
import { useReactFlow, getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';

export interface UseFlowExportOptions {
  fileName?: string;
  backgroundColor?: string;
  padding?: number;
  quality?: number;
}

/**
 * Hook for exporting ReactFlow graphs to PNG or SVG.
 *
 * @example
 * ```tsx
 * function MyFlow() {
 *   const { exportToPng, exportToSvg, ref } = useFlowExport();
 *
 *   return (
 *     <div ref={ref}>
 *       <ReactFlow ... />
 *       <Button onClick={() => exportToPng()}>Export PNG</Button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useFlowExport(options: UseFlowExportOptions = {}) {
  const {
    fileName = 'flow-export',
    backgroundColor = '#ffffff',
    padding = 20,
    quality = 0.95,
  } = options;

  const { getNodes } = useReactFlow();

  const downloadImage = useCallback(
    (dataUrl: string, extension: string) => {
      const link = document.createElement('a');
      link.download = `${fileName}.${extension}`;
      link.href = dataUrl;
      link.click();
    },
    [fileName],
  );

  const exportToPng = useCallback(async () => {
    const nodes = getNodes();
    if (nodes.length === 0) return;

    const nodesBounds = getNodesBounds(nodes);
    const viewport = getViewportForBounds(
      nodesBounds,
      nodesBounds.width + padding * 2,
      nodesBounds.height + padding * 2,
      0.5,
      2,
      padding,
    );

    const element = document.querySelector('.react-flow__viewport');
    if (!element) return;

    try {
      const dataUrl = await toPng(element as HTMLElement, {
        backgroundColor,
        quality,
        width: nodesBounds.width + padding * 2,
        height: nodesBounds.height + padding * 2,
        style: {
          transform: `translate(${String(viewport.x)}px, ${String(viewport.y)}px) scale(${String(viewport.zoom)})`,
        },
      });
      downloadImage(dataUrl, 'png');
    } catch (error) {
      console.error('Failed to export to PNG:', error);
    }
  }, [getNodes, backgroundColor, padding, quality, downloadImage]);

  const exportToSvg = useCallback(async () => {
    const nodes = getNodes();
    if (nodes.length === 0) return;

    const nodesBounds = getNodesBounds(nodes);
    const viewport = getViewportForBounds(
      nodesBounds,
      nodesBounds.width + padding * 2,
      nodesBounds.height + padding * 2,
      0.5,
      2,
      padding,
    );

    const element = document.querySelector('.react-flow__viewport');
    if (!element) return;

    try {
      const dataUrl = await toSvg(element as HTMLElement, {
        backgroundColor,
        width: nodesBounds.width + padding * 2,
        height: nodesBounds.height + padding * 2,
        style: {
          transform: `translate(${String(viewport.x)}px, ${String(viewport.y)}px) scale(${String(viewport.zoom)})`,
        },
      });
      downloadImage(dataUrl, 'svg');
    } catch (error) {
      console.error('Failed to export to SVG:', error);
    }
  }, [getNodes, backgroundColor, padding, downloadImage]);

  return {
    exportToPng,
    exportToSvg,
  };
}
