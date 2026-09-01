import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  capturePickerAnchor,
  PickerOverlayProvider,
  usePickerOverlay,
} from '@/components/pickers/picker-overlay';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          labels: {
            $get: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ items: [] }),
            }),
          },
        },
      },
    },
  },
}));

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');

describe('usePickerOverlay', () => {
  it('keeps the invoking geometry after a temporary overflow trigger unmounts', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 640,
      y: 224,
      top: 224,
      right: 760,
      bottom: 252,
      left: 640,
      width: 120,
      height: 28,
      toJSON: () => ({}),
    });

    const captured = capturePickerAnchor(anchor);
    anchor.remove();

    expect(captured.virtual?.getBoundingClientRect()).toMatchObject({
      left: 640,
      top: 224,
      width: 120,
      height: 28,
    });
    expect(captured.focusTarget).toBe(anchor);
  });

  it('throws when used outside a PickerOverlayProvider', () => {
    const { result } = renderHook(() => {
      try {
        return usePickerOverlay();
      } catch (error) {
        return error;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
  });

  it('opens the labels popover with a listbox once open() is called', async () => {
    const { wrapper } = makeQueryWrapper();

    function Trigger(): React.JSX.Element {
      const overlay = usePickerOverlay();
      return (
        <button
          type="button"
          onClick={() => {
            overlay.open({
              kind: 'labels',
              organizationId: ORG,
              objects: [{ kind: 'task', id: 'task_1', organizationId: ORG, title: 'Ship it' }],
              current: new Map([['task:task_1', []]]),
            });
          }}
        >
          Open
        </button>
      );
    }

    render(
      <PickerOverlayProvider>
        <Trigger />
      </PickerOverlayProvider>,
      { wrapper },
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Open' }).click();
    });

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });
});
