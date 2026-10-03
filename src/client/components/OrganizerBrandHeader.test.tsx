// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import OrganizerBrandHeader from './OrganizerBrandHeader';

describe('OrganizerBrandHeader', () => {
  it('renders nothing without a name or logo', () => {
    const { container } = render(<OrganizerBrandHeader name={null} color="#1D4ED8" logoUrl={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the name and logo on the brand colour with readable text', () => {
    render(<OrganizerBrandHeader name="Newtons TKD" color="#FFFF00" logoUrl="/logos/n.png" label="Hosted by" />);
    const header = screen.getByTestId('organizer-brand-header');
    expect(header).toHaveTextContent('Hosted by');
    expect(header).toHaveTextContent('Newtons TKD');
    expect(header).toHaveStyle({ backgroundColor: 'rgb(255, 255, 0)', color: 'rgb(15, 23, 42)' });
    // Decorative next to the written name.
    expect(header.querySelector('img')).toHaveAttribute('src', '/logos/n.png');
    expect(header.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('falls back to the default red for unsafe colours and drops unsafe logos', () => {
    render(<OrganizerBrandHeader name="Club" color="red;background:url(x)" logoUrl="javascript:alert(1)" />);
    const header = screen.getByTestId('organizer-brand-header');
    expect(header).toHaveStyle({ backgroundColor: 'rgb(220, 38, 38)', color: 'rgb(255, 255, 255)' });
    expect(header.querySelector('img')).toBeNull();
  });

  it('gives a logo-only header an accessible name and hides a broken logo', () => {
    const { container } = render(<OrganizerBrandHeader logoUrl="/logos/missing.png" />);
    const img = screen.getByRole('img', { name: 'Organizer logo' });
    fireEvent.error(img);
    expect(container).toBeEmptyDOMElement();
  });
});
