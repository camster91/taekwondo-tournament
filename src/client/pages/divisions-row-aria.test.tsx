// @vitest-environment jsdom
// Regression test for MEDIUM 3.12 from review/03-frontend.md:
// The Split and Delete icon-only buttons in SortableDivisionRow had title
// attributes but no aria-label, so screen readers could not announce them.
// The fix adds aria-label={`Split ${div.name} division`} and
// aria-label={`Delete ${div.name} division`} to match the existing
// "Manage competitors in ${div.name}" pattern.
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SortableDivisionRow } from './Divisions';
import type { ApiDivisionWithCount } from '../../shared/contracts/division';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

const baseDivision: ApiDivisionWithCount = {
  id: 'div-1',
  name: 'Black Belt Males Sparring',
  eventType: 'sparring',
  ageMin: 18,
  ageMax: 35,
  weightClass: 'Middleweight',
  belt: 'black',
  gender: 'male',
  bracket: null,
  _count: { assignments: 12 }, // > 8 so the Split button renders
};

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  return {
    host,
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

function RowHarness({ div }: { div: ApiDivisionWithCount }) {
  return (
    <DndContext>
      <SortableContext items={[div.id]} strategy={verticalListSortingStrategy}>
        <SortableDivisionRow
          div={div}
          tournamentId="t-1"
          onManageCompetitors={vi.fn()}
          onSplit={vi.fn()}
          onDelete={vi.fn()}
        />
      </SortableContext>
    </DndContext>
  );
}

describe('SortableDivisionRow icon-only buttons (MEDIUM 3.12)', () => {
  it('gives the Split button an aria-label that names the division', async () => {
    const { cleanup } = await mount(<RowHarness div={baseDivision} />);

    const splitBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Split "]',
    );
    expect(splitBtn).not.toBeNull();
    expect(splitBtn!.getAttribute('aria-label')).toBe(
      'Split Black Belt Males Sparring division',
    );
    // Split only renders when assignment count is > 8.
    expect(baseDivision._count!.assignments).toBeGreaterThan(8);

    cleanup();
  });

  it('gives the Delete button an aria-label that names the division', async () => {
    const { cleanup } = await mount(<RowHarness div={baseDivision} />);

    const deleteBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Delete "]',
    );
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn!.getAttribute('aria-label')).toBe(
      'Delete Black Belt Males Sparring division',
    );

    cleanup();
  });

  it('keeps the existing Manage button aria-label unchanged for parity', async () => {
    const { cleanup } = await mount(<RowHarness div={baseDivision} />);

    const manageBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Manage competitors in "]',
    );
    expect(manageBtn).not.toBeNull();
    expect(manageBtn!.getAttribute('aria-label')).toBe(
      'Manage competitors in Black Belt Males Sparring',
    );

    cleanup();
  });

  it('hides the decorative icons from the accessibility tree', async () => {
    const { cleanup } = await mount(<RowHarness div={baseDivision} />);

    // Lucide icons are SVGs without aria-label — they should be aria-hidden
    // so AT does not announce raw SVG names alongside the button label.
    const splitBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Split "]',
    )!;
    const splitIcon = splitBtn.querySelector('svg');
    expect(splitIcon?.getAttribute('aria-hidden')).toBe('true');

    const deleteBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Delete "]',
    )!;
    const deleteIcon = deleteBtn.querySelector('svg');
    expect(deleteIcon?.getAttribute('aria-hidden')).toBe('true');

    cleanup();
  });
});
