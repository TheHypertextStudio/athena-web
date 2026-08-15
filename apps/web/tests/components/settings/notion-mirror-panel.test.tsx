/**
 * Behavior tests for {@link NotionMirrorPanel} — the Docket-in-Notion hub.
 *
 * @remarks
 * The page answers different questions before and after provisioning, and these pin both shapes.
 *
 * Before, the only question is how to start, so the setup card leads and the tables collapse into
 * a preview — they used to be nine expanded rows offering to configure tables that did not exist.
 *
 * After, the questions are where the databases went and how to reach one. Both answers were
 * already stored and neither was rendered: the container page went into the connector config and
 * was never shown again, and each row's `externalUrl` was read from Notion at provision time and
 * dropped on the floor.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQueryWrapper, okResponse } from '../../support/query';

// Hoisted so the mock factory (lifted above imports) can reference them.
const { integrationsGet, databasesGet, peopleGet, unmatchedGet, runsGet, syncPost, linkSocial } =
  vi.hoisted(() => ({
    integrationsGet: vi.fn(),
    databasesGet: vi.fn(),
    peopleGet: vi.fn(),
    unmatchedGet: vi.fn(),
    runsGet: vi.fn(),
    syncPost: vi.fn(),
    linkSocial: vi.fn(),
  }));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          integrations: {
            $get: integrationsGet,
            ':id': {
              runs: { $get: runsGet },
              notion: {
                databases: { $get: databasesGet },
                people: { $get: peopleGet },
                'unmatched-people': { $get: unmatchedGet },
                'parent-pages': { $get: vi.fn() },
                provision: { $post: vi.fn() },
                sync: { $post: syncPost },
              },
            },
          },
          members: { $get: vi.fn() },
        },
      },
    },
  },
}));

vi.mock('../../../src/lib/auth-client', () => ({ authClient: { linkSocial } }));

import { NotionMirrorPanel } from '../../../src/components/settings/notion/notion-mirror-panel';
// Imported rather than spelled out, so the wording stays a product decision the copy module owns.
import {
  RECONNECT_ACTION,
  SETUP_ACTION,
  SETUP_TITLE,
  SYNC_ACTION,
} from '../../../src/components/settings/notion/notion-copy';

const ORG_ID = 'org_1';

/** A connected Notion integration, optionally carrying a recorded container page. */
function integration(config: Record<string, unknown> = {}) {
  return {
    id: 'int_1',
    organizationId: ORG_ID,
    provider: 'notion',
    pattern: 'connector',
    roles: ['work'],
    connection: { account: 'notion', externalWorkspaceName: 'Las Vegans for Better Transit' },
    status: 'connected',
    config,
    externalAccountId: null,
    syncMode: 'mirror',
    writeBack: false,
    lastSyncStatus: null,
    lastSyncedAt: null,
    lastError: null,
    lastErrorAt: null,
    syncCadenceMinutes: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

/** One designed database; `provisionedAt` is what decides which shape the page takes. */
function database(over: Record<string, unknown> = {}) {
  return {
    id: 'db_1',
    entityType: 'task',
    title: 'Tasks',
    direction: 'two_way',
    enabled: true,
    provisionedAt: null,
    externalUrl: null,
    lastPushedAt: null,
    rowCount: 0,
    ...over,
  };
}

function renderPanel(): void {
  const { wrapper } = makeQueryWrapper();
  render(<NotionMirrorPanel orgId={ORG_ID} />, { wrapper });
}

/** One sync run as `GET /:id/runs` returns it, newest-first. */
function syncRun(over: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    integrationId: 'int_1',
    status: 'succeeded',
    trigger: 'manual',
    purpose: 'notion_mirror',
    processed: 1,
    total: 1,
    error: null,
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  peopleGet.mockResolvedValue(okResponse({ items: [] }));
  unmatchedGet.mockResolvedValue(okResponse({ docketOnly: 0 }));
  runsGet.mockResolvedValue(okResponse({ items: [] }));
  syncPost.mockResolvedValue(okResponse(syncRun()));
});

afterEach(cleanup);

describe('NotionMirrorPanel — before anything is provisioned', () => {
  beforeEach(() => {
    integrationsGet.mockResolvedValue(okResponse({ items: [integration()] }));
    databasesGet.mockResolvedValue(okResponse({ items: [database(), database({ id: 'db_2' })] }));
  });

  it('leads with the setup card and folds the tables into a closed preview', async () => {
    renderPanel();
    expect(await screen.findByText('Set up Docket in Notion')).toBeInTheDocument();

    const disclosure = screen.getByText(/What Docket will create/);
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
  });

  it('offers to customize a table, not to configure one that does not exist', async () => {
    renderPanel();
    const links = await screen.findAllByRole('link', { name: 'Customize' });
    expect(links).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Configure' })).not.toBeInTheDocument();
  });
});

describe('NotionMirrorPanel — once the databases exist', () => {
  const provisioned = {
    provisionedAt: '2026-01-02T00:00:00Z',
    externalUrl: 'https://www.notion.so/tasks-db',
  };

  // The default: provisioned, but with no container page recorded — the shape an older connection
  // has. Only the first test below overrides it.
  beforeEach(() => {
    integrationsGet.mockResolvedValue(okResponse({ items: [integration()] }));
    databasesGet.mockResolvedValue(okResponse({ items: [database(provisioned)] }));
  });

  it('names the page the databases were built under, and links to it', async () => {
    // Recorded at provision time and, until now, never shown — leaving "where did those nine
    // databases go?" answerable only by searching Notion.
    integrationsGet.mockResolvedValue(
      okResponse({
        items: [
          integration({
            notionMirror: {
              containerPageId: 'page_wiki',
              containerPageTitle: 'Team wiki',
              containerPageUrl: 'https://www.notion.so/team-wiki',
            },
          }),
        ],
      }),
    );
    renderPanel();

    expect(await screen.findByText('Where this lives')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Team wiki/ })).toHaveAttribute(
      'href',
      'https://www.notion.so/team-wiki',
    );
  });

  it('gives every table a way out to the real Notion database', async () => {
    renderPanel();

    expect(await screen.findByRole('link', { name: /Open in Notion/ })).toHaveAttribute(
      'href',
      'https://www.notion.so/tasks-db',
    );
    expect(screen.getByRole('link', { name: 'Configure' })).toBeInTheDocument();
    expect(screen.queryByText('Set up Docket in Notion')).not.toBeInTheDocument();
  });

  it('omits the container row for a connection provisioned before it was recorded', async () => {
    // Older connections stored only the id. The surface has to render without the name rather
    // than show a link to nowhere.
    renderPanel();

    await screen.findByRole('link', { name: 'Configure' });
    expect(screen.queryByText('Where this lives')).not.toBeInTheDocument();
  });
});

describe('NotionMirrorPanel — saying whether the sync actually works', () => {
  const provisioned = {
    provisionedAt: '2026-01-02T00:00:00Z',
    externalUrl: 'https://www.notion.so/tasks-db',
  };
  const withPage = {
    notionMirror: { containerPageId: 'page_wiki', containerPageTitle: 'Team wiki' },
  };

  beforeEach(() => {
    databasesGet.mockResolvedValue(okResponse({ items: [database(provisioned)] }));
    integrationsGet.mockResolvedValue(okResponse({ items: [integration(withPage)] }));
  });

  it('raises an alert instead of a success chip when the connection is broken', async () => {
    // The chip used to be hardcoded green, so a connection the server had already demoted to
    // `error` still rendered as connected — the page reporting health it did not have.
    integrationsGet.mockResolvedValue(
      okResponse({ items: [{ ...integration(withPage), status: 'error' }] }),
    );
    renderPanel();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('stays quiet when the connection and the mirror are both healthy', async () => {
    // The counterpart to the two cases above: without this, an implementation that always
    // rendered an alert would satisfy them and still be wrong.
    runsGet.mockResolvedValue(okResponse({ items: [syncRun({ status: 'succeeded' })] }));
    renderPanel();

    await screen.findByRole('link', { name: 'Configure' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failed mirror run even though the connection itself is fine', async () => {
    // The state that was previously invisible: the credential works, so every connection-level
    // signal reads healthy, while the pass this page is about has not succeeded.
    runsGet.mockResolvedValue(okResponse({ items: [syncRun({ status: 'failed' })] }));
    renderPanel();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('ignores another purpose running against the same connection', async () => {
    // A successful task_sync advances the integration's roll-up without the mirror having run.
    // Treating it as the mirror's own outcome is exactly the substitution that hid the breakage.
    runsGet.mockResolvedValue(
      okResponse({ items: [syncRun({ purpose: 'task_sync', status: 'succeeded' })] }),
    );
    renderPanel();

    await screen.findByRole('link', { name: 'Configure' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a way to run the mirror, and reports a failed run as a failure', async () => {
    // A failed pass arrives as a 200 carrying `status: 'failed'`. Reading the response code as
    // success is the dishonesty this branch exists to prevent.
    syncPost.mockResolvedValue(okResponse(syncRun({ status: 'failed' })));
    renderPanel();

    const button = await screen.findByRole('button', { name: SYNC_ACTION });
    await userEvent.click(button);

    expect(syncPost).toHaveBeenCalledWith({ param: { orgId: ORG_ID, id: 'int_1' } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('withholds the run action until a container page has been chosen', async () => {
    // Nothing to run against, and the route would 409 — so offering the button would be an
    // affordance that cannot work.
    integrationsGet.mockResolvedValue(okResponse({ items: [integration()] }));
    renderPanel();

    await screen.findByRole('link', { name: 'Configure' });
    expect(screen.queryByRole('button', { name: SYNC_ACTION })).not.toBeInTheDocument();
  });

  it('withholds the run action while the connection itself is broken', async () => {
    // A pass against a rejected credential cannot succeed, and the sync spine records every
    // failure — so pressing it would re-demote the connection and notify its owner about a
    // breakage they are already looking at.
    integrationsGet.mockResolvedValue(
      okResponse({ items: [{ ...integration(withPage), status: 'error' }] }),
    );
    renderPanel();

    await screen.findByRole('link', { name: 'Configure' });
    expect(screen.queryByRole('button', { name: SYNC_ACTION })).not.toBeInTheDocument();
  });
});

describe('NotionMirrorPanel — a broken connection with nothing provisioned', () => {
  // The state in the reported screenshot: the credential is dead, nothing has been built yet, and
  // the page offered to build it anyway.
  beforeEach(() => {
    integrationsGet.mockResolvedValue(
      okResponse({ items: [{ ...integration(), status: 'error' }] }),
    );
    databasesGet.mockResolvedValue(okResponse({ items: [database()] }));
  });

  it('withholds the setup card rather than offering a build that cannot work', async () => {
    // Provisioning creates the databases and then projects rows through the same credential, so
    // starting one here fails partway and leaves empty tables behind.
    renderPanel();

    await screen.findByRole('alert');
    expect(screen.queryByText(SETUP_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SETUP_ACTION })).not.toBeInTheDocument();
  });

  it('offers the repair on the page instead of directions to another one', async () => {
    // The alert used to name a Reconnect button that only existed one level up, in Connections.
    renderPanel();

    expect(await screen.findByRole('button', { name: RECONNECT_ACTION })).toBeInTheDocument();
  });

  it('still shows what it would create, so the page is not a dead end', async () => {
    renderPanel();

    await screen.findByRole('alert');
    expect(screen.getByText(/What Docket will create/)).toBeInTheDocument();
  });
});
