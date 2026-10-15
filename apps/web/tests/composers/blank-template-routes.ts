/** Empty published base templates used by composer tests whose subject is ordinary root fields. */
export const blankTemplateRoutes = {
  $get: async ({ query }: { query: { targetType?: string } }) => {
    const kind = query.targetType ?? 'task';
    const definition = {
      name: 'Blank work',
      payload: { targetType: kind },
      blueprint: { steps: [], dependencies: [] },
    };
    return Response.json({
      items: [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          isBase: true,
          offeredTeamIds: [],
          status: 'published',
          definition,
          latestVersion: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', number: 1, definition },
        },
      ],
    });
  },
  ':id': {
    'blueprint-preview': {
      $post: async () =>
        Response.json({
          workTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          workTypeVersionId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
          previewToken: `sha256:${'a'.repeat(64)}`,
          resolvedManifest: [],
          descendants: [],
          descendantCount: 0,
          selectedCount: 1,
          additionalMilestoneCount: 0,
          summaryOffset: 0,
          nextSummaryOffset: null,
          warnings: [],
        }),
    },
  },
};
