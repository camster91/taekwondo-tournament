import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import OperationStatus, { operationStatusLabel, type OperationState } from './OperationStatus.js';

describe('OperationStatus', () => {
  it('defines a stable label for every universal operation state', () => {
    const states: OperationState[] = ['pending', 'saved', 'queued', 'retrying', 'rejected', 'resolved'];
    expect(states.map(operationStatusLabel)).toEqual(['Saving', 'Saved', 'Queued offline', 'Retrying', 'Needs review', 'Resolved']);
  });

  it('renders rejected work as an assertive alert with a recovery action', () => {
    const html = renderToStaticMarkup(createElement(OperationStatus, {
      state: 'rejected',
      message: 'The server changed this match while you were offline.',
      actionLabel: 'Review conflict',
      onAction: vi.fn(),
    }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Needs review');
    expect(html).toContain('Review conflict');
  });

  it('announces queued work without presenting it as saved remotely', () => {
    const html = renderToStaticMarkup(createElement(OperationStatus, {
      state: 'queued',
      message: '1 result will sync when the connection returns.',
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain('Queued offline');
    expect(html).not.toContain('Saved remotely');
  });
});
