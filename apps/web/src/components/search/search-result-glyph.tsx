import type { JSX } from 'react';
import { defaultEntityDisplay } from '@docket/work/entity-display-contract';
import { ActorAvatar } from '@docket/ui/components';
import type { SearchResult, SearchDocumentKind } from '@/lib/contracts/search';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { SEARCH_KIND_ICON } from '@/components/command-palette/use-hub-search';

/** Render people consistently with the same avatar treatment in cached and indexed results. */
export function SearchResultGlyph({ result }: { result: SearchResult }): JSX.Element {
  if (result.kind === 'member') return <ActorAvatar kind="human" name={result.title} size={20} />;
  const Icon = SEARCH_KIND_ICON[result.kind];
  const subjectType = searchDisplaySubjectType(result.kind);
  const display =
    subjectType && result.organizationId
      ? (result.display ?? defaultEntityDisplay(subjectType, result.entityId))
      : null;
  return display ? (
    <EntityIconGlyph
      subjectType={display.subjectType}
      glyph={display.glyph}
      colorKey={display.colorKey}
      customColor={display.customColor}
      size={20}
    />
  ) : (
    <Icon aria-hidden="true" className="text-on-surface-variant mt-0.5 size-4 shrink-0" />
  );
}

function searchDisplaySubjectType(kind: SearchDocumentKind) {
  switch (kind) {
    case 'team':
    case 'task':
    case 'project':
    case 'program':
    case 'initiative':
    case 'milestone':
    case 'cycle':
    case 'label':
      return kind;
    default:
      return null;
  }
}
