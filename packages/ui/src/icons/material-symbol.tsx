import type { MaterialSymbolName } from '@docket/work/entity-display-contract';
import type { CSSProperties, JSX } from 'react';

/** Props for one ligature rendered by the self-hosted Material Symbols Rounded font. */
export interface MaterialSymbolProps {
  /** Validated ligature name from the pinned symbol catalog. */
  readonly name: MaterialSymbolName;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Render one unfilled weight-400 rounded Material Symbol. */
export function MaterialSymbol({ name, className, style }: MaterialSymbolProps): JSX.Element {
  return (
    <span aria-hidden className={`material-symbols-rounded ${className ?? ''}`} style={style}>
      {name}
    </span>
  );
}
