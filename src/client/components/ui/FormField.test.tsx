// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Input from './Input';
import Select from './Select';
import Textarea from './Textarea';
import FormField from './FormField';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Accessible Field Error Contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Input sets aria-invalid, connects aria-describedby, and renders alert error message', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <Input
          id="email-field"
          error="Please enter a valid email address"
          helperText="We will never share your email"
        />
      );
    });

    const input = document.querySelector<HTMLInputElement>('#email-field')!;
    expect(input).not.toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toContain('email-field-error');
    expect(describedBy).toContain('email-field-helper');

    const errorEl = document.querySelector('[role="alert"]')!;
    expect(errorEl).not.toBeNull();
    expect(errorEl.id).toBe('email-field-error');
    expect(errorEl.textContent).toContain('Please enter a valid email address');

    const helperEl = document.getElementById('email-field-helper')!;
    expect(helperEl).not.toBeNull();
    expect(helperEl.textContent).toContain('We will never share your email');

    await act(async () => {
      root.unmount();
    });
  });

  it('Select sets aria-invalid, connects aria-describedby, and renders alert error message', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <Select id="role-select" error="Please select a role">
          <option value="">Select a role...</option>
          <option value="admin">Admin</option>
        </Select>
      );
    });

    const select = document.querySelector<HTMLSelectElement>('#role-select')!;
    expect(select).not.toBeNull();
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')).toBe('role-select-error');

    const errorEl = document.getElementById('role-select-error')!;
    expect(errorEl.textContent).toContain('Please select a role');

    await act(async () => {
      root.unmount();
    });
  });

  it('Textarea sets aria-invalid, connects aria-describedby, and renders alert error message', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <Textarea id="notes-field" error="Notes cannot exceed 500 characters" />
      );
    });

    const textarea = document.querySelector<HTMLTextAreaElement>('#notes-field')!;
    expect(textarea).not.toBeNull();
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(textarea.getAttribute('aria-describedby')).toBe('notes-field-error');

    const errorEl = document.getElementById('notes-field-error')!;
    expect(errorEl.textContent).toContain('Notes cannot exceed 500 characters');

    await act(async () => {
      root.unmount();
    });
  });

  it('FormField wrapper links label, error, and helperText', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <FormField
          id="custom-field"
          label="Full Name"
          required
          error="Name is required"
          helperText="Enter first and last name"
        >
          <input id="custom-field" />
        </FormField>
      );
    });

    const label = document.querySelector('label')!;
    expect(label.getAttribute('for')).toBe('custom-field');
    expect(label.textContent).toContain('Full Name');
    expect(label.textContent).toContain('*');

    const errorEl = document.querySelector('[role="alert"]')!;
    expect(errorEl.id).toBe('custom-field-error');
    expect(errorEl.textContent).toContain('Name is required');

    const helperEl = document.getElementById('custom-field-helper')!;
    expect(helperEl.textContent).toContain('Enter first and last name');

    await act(async () => {
      root.unmount();
    });
  });
});
