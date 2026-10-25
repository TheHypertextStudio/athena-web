import { AuthError, CapabilityError } from '../error';
import { isAutomatedTemplateContext } from '../agent/template-authority';
import {
  getTemplateGalleryDetail,
  getTemplateGalleryFork,
  listTemplateGallery,
} from '../lib/template-gallery/catalog';
import {
  acceptTemplateSourceCopy,
  previewTemplateSourceCopy,
} from '../lib/template-gallery/source-preview';
import { reconcileTemplateGalleryCopy } from '../lib/template-gallery/acceptance';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import {
  browseWorkTemplatesDefinition,
  copyWorkTemplatesDefinition,
} from './template-copy-tools-contract';

/** Register immutable starter discovery and manual independent copies without another persistence path. */
export function registerTemplateCopyTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool('browse_work_templates', browseWorkTemplatesDefinition, (input) =>
    runTool(async () => {
      const actor = await scopedActor(ctx, input.orgId, 'work:read');
      await authorize(actor, 'view', { kind: 'organization', id: actor.orgId, orgId: actor.orgId });
      const query = input.query;
      if (query.action === 'detail')
        return jsonResult({ data: getTemplateGalleryDetail(query.slug) });
      if (query.action === 'fork') return jsonResult({ data: getTemplateGalleryFork(query.fork) });
      const { action: _action, limit, cursor, ...filters } = query;
      return jsonResult({
        data: listTemplateGallery(filters, { limit, ...(cursor ? { cursor } : {}) }),
      });
    }),
  );
  server.registerTool('copy_work_templates', copyWorkTemplatesDefinition, (input) =>
    runTool(async () => {
      const query = input.query;
      const actor = await scopedActor(
        ctx,
        input.orgId,
        query.action === 'keep' ? 'work:write' : 'work:read',
      );
      if (ctx.principal.kind !== 'user') throw new AuthError();
      const principal = { organizationId: actor.orgId, userId: ctx.principal.userId };
      if (query.action === 'reconcile')
        return jsonResult({ data: await reconcileTemplateGalleryCopy(principal, query.requestId) });
      const { action, ...choices } = query;
      if (action === 'preview')
        return jsonResult({ data: await previewTemplateSourceCopy(principal, choices) });
      if (isAutomatedTemplateContext(ctx))
        throw new CapabilityError('Review suggested work in Inbox before keeping it.');
      // Keep the discriminated input intact until after the action branch narrows it.
      const { action: _action, ...accepted } = query;
      return jsonResult({ data: await acceptTemplateSourceCopy(principal, accepted) });
    }),
  );
}
