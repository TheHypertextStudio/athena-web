/** Named synthetic work used to exercise the real projection and rendered resource. */
import type { GraphData, GraphWork } from '../../src/work-graph/contract';

const titles = [
  'Create an account',
  'Sign in with a passkey',
  'Recover account access',
  'Review team permissions',
  'Invite a teammate',
  'Accept an invitation',
  'Set membership options',
  'Review member details',
  'Collect membership dues',
  'Send a receipt',
  'Test payment recovery',
  'Export member records',
  'Write the launch guide',
  'Record the welcome walkthrough',
  'Prepare support responses',
  'Invite the pilot group',
  'Review pilot feedback',
  'Resolve accessibility issues',
  'Publish the portal',
  'Review the first week',
];

const dependencyPairs = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
  [6, 8],
  [8, 9],
  [8, 10],
  [7, 11],
  [11, 12],
  [12, 13],
  [12, 14],
  [13, 15],
  [14, 15],
  [15, 16],
  [16, 17],
  [17, 18],
];

/** Build a realistic, entirely synthetic program with parallel projects and external context. */
export function graphFixture(): GraphData {
  const nodes: GraphWork[] = [];
  const add = (
    id: string,
    kind: GraphWork['kind'],
    title: string,
    category: GraphWork['category'] = 'unstarted',
  ) => {
    const node = {
      key: `${kind}:${id}`,
      id,
      kind,
      title,
      category,
      status: {
        backlog: 'Backlog',
        unstarted: 'To do',
        started: 'In progress',
        completed: 'Done',
        canceled: 'Canceled',
      }[category],
      priority: 'medium',
      href: `/orgs/demo/${kind}s/${id}`,
    };
    nodes.push(node);
    return node.key;
  };
  add('portal', 'program', 'Member portal');
  add('identity', 'project', 'Identity and access', 'started');
  add('membership', 'project', 'Membership');
  add('launch', 'project', 'Launch and adoption');
  const relations: GraphData['relations'][number][] = [];
  for (const project of ['identity', 'membership', 'launch'])
    relations.push({ source: 'program:portal', target: 'project:' + project, kind: 'contains' });
  titles.forEach((title, index) => {
    const id = 't' + String(index).padStart(2, '0');
    add(
      id,
      'task',
      title,
      index < 3
        ? 'completed'
        : index === 3 || index === 6
          ? 'started'
          : index === 19
            ? 'canceled'
            : 'unstarted',
    );
    relations.push({
      source: 'project:' + (index < 6 ? 'identity' : index < 12 ? 'membership' : 'launch'),
      target: 'task:' + id,
      kind: 'contains',
    });
  });
  for (const [a, b] of dependencyPairs)
    relations.push({
      source: 'task:t' + String(a).padStart(2, '0'),
      target: 'task:t' + String(b).padStart(2, '0'),
      kind: 'task_dependency',
    });
  add('review', 'task', 'Approve the membership policy', 'started');
  relations.push({ source: 'task:review', target: 'task:t06', kind: 'task_dependency' });
  relations.push({
    source: 'project:identity',
    target: 'project:membership',
    kind: 'project_dependency',
  });
  return { nodes, relations };
}
