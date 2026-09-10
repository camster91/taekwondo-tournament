// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import Input from './Input';
import Select from './Select';
import Textarea from './Textarea';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return {
    host,
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

describe('Input a11y wiring on error', () => {
  it('sets aria-invalid when error is present and stays unset when absent', async () => {
    const { host, cleanup } = await render(
      <>
        <Input data-testid="clean" placeholder="Email" />
        <Input data-testid="errored" error="Email already in use" />
      </>,
    );

    const clean = host.querySelector<HTMLInputElement>('[data-testid="clean"]')!;
    const errored = host.querySelector<HTMLInputElement>('[data-testid="errored"]')!;

    expect(clean.getAttribute('aria-invalid')).not.toBe('true');
    expect(errored.getAttribute('aria-invalid')).toBe('true');

    cleanup();
  });

  it('wires aria-describedby to the caller-provided errorId only when error is set', async () => {
    const { host, cleanup } = await render(
      <>
        <Input data-testid="no-error" errorId="signup-error" placeholder="Email" />
        <Input data-testid="with-error" errorId="signup-error" error="Invalid" />
      </>,
    );

    const noError = host.querySelector<HTMLInputElement>('[data-testid="no-error"]')!;
    const withError = host.querySelector<HTMLInputElement>('[data-testid="with-error"]')!;

    expect(noError.getAttribute('aria-describedby')).toBeNull();
    expect(withError.getAttribute('aria-describedby')).toBe('signup-error');

    cleanup();
  });

  it('keeps the consumer-supplied aria-describedby when no errorId is provided', async () => {
    const { host, cleanup } = await render(
      <Input aria-describedby="external-help" error="Required field" placeholder="Name" />,
    );

    const input = host.querySelector<HTMLInputElement>('input')!;
    expect(input.getAttribute('aria-describedby')).toBe('external-help');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    cleanup();
  });
});

describe('Select a11y wiring on error', () => {
  it('sets aria-invalid and aria-describedby when error is set', async () => {
    const { host, cleanup } = await render(
      <>
        <Select data-testid="clean"><option>x</option></Select>
        <Select data-testid="errored" error="Pick one" errorId="select-error"><option>x</option></Select>
      </>,
    );

    const clean = host.querySelector<HTMLSelectElement>('[data-testid="clean"]')!;
    const errored = host.querySelector<HTMLSelectElement>('[data-testid="errored"]')!;

    expect(clean.getAttribute('aria-invalid')).not.toBe('true');
    expect(clean.getAttribute('aria-describedby')).toBeNull();
    expect(errored.getAttribute('aria-invalid')).toBe('true');
    expect(errored.getAttribute('aria-describedby')).toBe('select-error');

    cleanup();
  });
});

describe('Textarea a11y wiring on error', () => {
  it('wires aria-invalid and aria-describedby when rendered with Textarea + error', async () => {
    const { host, cleanup } = await render(
      <Textarea error="Required" errorId="msg-id" />,
    );

    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(textarea.getAttribute('aria-describedby')).toBe('msg-id');

    cleanup();
  });
});
