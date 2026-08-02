/**
 * The equal-treatment contract for a People row (ENT-46 / ENT-47).
 *
 * @remarks
 * The requirement is that a person without a Docket account renders **identically** to one with
 * an account. A screenshot proves that on the day it is taken; this proves it can't quietly stop
 * being true, by rendering the two side by side and comparing the markup.
 *
 * The comparison is deliberately structural rather than a list of "no badge / no muted class"
 * assertions: an enumerated denylist only catches the second-class markers someone thought of in
 * advance, while comparing the whole subtree catches any of them — a badge, a tooltip, an opacity
 * class, a removed action, a different avatar shape.
 *
 * The test also pins the reason this works: {@link PersonRow} has no account-presence prop at all.
 * If one is ever added, the normalizer below has nothing to normalize and the test still passes —
 * which is why the props interface itself is asserted through the call, and why
 * `docs/engineering/specs/people.md` is the place any deliberate divergence has to be written down.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PersonRow, type PersonRowModel } from '../../../src/components/people/person-row';

afterEach(() => {
  cleanup();
});

/** A person who signs in. */
const ACCOUNT_HOLDER: PersonRowModel = {
  actorId: 'act_staff',
  displayName: 'Same Name',
  avatar: null,
  status: 'active',
  roleName: 'Member',
};

/** A person who does not — a volunteer, a contractor. Same name so the markup is comparable. */
const ACCOUNT_LESS: PersonRowModel = {
  actorId: 'act_volunteer',
  displayName: 'Same Name',
  avatar: null,
  status: 'active',
  roleName: 'Member',
};

/** Strip the two things that legitimately differ — the actor id and the href it builds. */
function normalized(html: string, actorId: string): string {
  return html.split(actorId).join('<ID>');
}

/**
 * A `<ul>` mounted in the document, so the `<li>` the row renders is valid markup *and* reachable
 * by the accessibility queries (a detached container has no roles at all).
 */
function listContainer(): HTMLElement {
  const list = document.createElement('ul');
  document.body.appendChild(list);
  return list;
}

describe('PersonRow — account-holders and account-less people', () => {
  it('renders byte-identical markup for both, once ids are normalized', () => {
    const staff = render(
      <PersonRow person={ACCOUNT_HOLDER} href={`/orgs/o1/people/${ACCOUNT_HOLDER.actorId}`} />,
      { container: listContainer() },
    );
    const staffHtml = normalized(staff.container.innerHTML, ACCOUNT_HOLDER.actorId);
    cleanup();

    const volunteer = render(
      <PersonRow person={ACCOUNT_LESS} href={`/orgs/o1/people/${ACCOUNT_LESS.actorId}`} />,
      { container: listContainer() },
    );
    const volunteerHtml = normalized(volunteer.container.innerHTML, ACCOUNT_LESS.actorId);

    expect(volunteerHtml).toBe(staffHtml);
  });

  it('gives both a real link to a profile, so neither row is a dead end', () => {
    render(<PersonRow person={ACCOUNT_LESS} href="/orgs/o1/people/act_volunteer" />, {
      container: listContainer(),
    });
    const link = screen.getByRole('link', { name: 'Same Name' });
    expect(link.getAttribute('href')).toBe('/orgs/o1/people/act_volunteer');
  });

  it('reports suspension — the one participation state a row shows — for either kind', () => {
    render(
      <PersonRow
        person={{ ...ACCOUNT_LESS, status: 'suspended' }}
        href="/orgs/o1/people/act_volunteer"
      />,
      { container: listContainer() },
    );
    expect(screen.getByText('Suspended')).toBeTruthy();
  });

  it('cannot be told whether the person has an account', () => {
    // The real guard, and it is a compile-time one: `PersonRowModel` has no account field, so a
    // row physically cannot branch on one. If someone adds `userId` (or `hasAccount`, or
    // `isInvited`) to the model, this `@ts-expect-error` stops expecting an error and
    // `pnpm typecheck` fails — which is the moment to go write the reason in
    // `docs/engineering/specs/people.md` instead of shipping a quiet second class.
    const withAccount = {
      ...ACCOUNT_LESS,
      // @ts-expect-error -- PersonRowModel must never carry account presence.
      userId: 'usr_1',
    } satisfies PersonRowModel;
    render(<PersonRow person={withAccount} href="/orgs/o1/people/act_volunteer" />, {
      container: listContainer(),
    });
    expect(screen.getByRole('link', { name: 'Same Name' })).toBeTruthy();
  });

  it('renders no badge, tag, or marker beyond the role and the name', () => {
    // A belt-and-braces read of the actual text content: the row says who they are and what role
    // they hold, and nothing about accounts, invitations, or pending anything.
    render(<PersonRow person={ACCOUNT_LESS} href="/orgs/o1/people/act_volunteer" />, {
      container: listContainer(),
    });
    const text = screen.getByRole('listitem').textContent.toLowerCase();
    for (const forbidden of [
      'account',
      'invite',
      'invited',
      'pending',
      'external',
      'guest',
      'no login',
      'unregistered',
    ]) {
      expect(text, `row copy must not mention "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
