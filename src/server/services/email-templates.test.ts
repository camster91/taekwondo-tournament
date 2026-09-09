import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  registrationConfirmationEmail,
  waitlistNotificationEmail,
  waitlistPromotionEmail,
} from './email-templates.js';

describe('email-templates', () => {
  describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
      expect(escapeHtml("O'Brien & Co.")).toBe('O&#039;Brien &amp; Co.');
    });
  });

  describe('registrationConfirmationEmail', () => {
    it('generates tenant-branded confirmation email', () => {
      const params = {
        competitorName: 'John Doe',
        tournamentName: 'Spring Championship 2026',
        tournamentDate: new Date('2026-05-15'),
        tournamentLocation: 'Community Center',
        events: 'Patterns & Sparring',
        ageGroup: '10-11',
        parentName: 'Jane Doe',
        confirmationCode: 'ABC12345',
        managementUrl: 'https://example.com/manage?token=xyz',
        organizerBrandName: 'Master Kim Academy',
      };

      const { subject, html } = registrationConfirmationEmail(params);

      expect(subject).toContain('Spring Championship 2026');
      expect(html).toContain('John Doe');
      expect(html).toContain('Master Kim Academy');
      expect(html).toContain('Patterns &amp; Sparring');
      expect(html).toContain('ABC12345');
      expect(html).toContain('Community Center');
      expect(html).toContain('Hi Jane Doe,');
      expect(html).toContain('https://example.com/manage?token=xyz');
      // Should use organizer brand in header/footer, not Bowin
      expect(html).toContain('<h1>Master Kim Academy</h1>');
      expect(html).not.toContain('<h1>bowin</h1>');
      expect(html).not.toContain('Powered by Bowin');
      expect(html).not.toContain('run like a black belt');
    });

    it('handles missing optional fields gracefully', () => {
      const params = {
        competitorName: 'John Doe',
        tournamentName: 'Spring Championship',
        tournamentDate: new Date('2026-05-15'),
        tournamentLocation: null,
        events: 'Sparring',
        ageGroup: '8-9',
        confirmationCode: 'XYZ789',
        managementUrl: 'https://example.com/manage',
      };

      const { subject, html } = registrationConfirmationEmail(params);

      expect(subject).toContain('Spring Championship');
      expect(html).toContain('John Doe');
      expect(html).toContain('Hi,');
      expect(html).not.toContain('Location:');
      expect(html).toContain('XYZ789');
      // Without organizer brand, falls back to bowin (staff emails only)
      expect(html).toContain('<h1>bowin</h1>');
    });
  });

  describe('waitlistNotificationEmail', () => {
    it('generates waitlist notification with position', () => {
      const params = {
        competitorName: 'Alice Smith',
        tournamentName: 'Fall Classic',
        tournamentDate: new Date('2026-10-20'),
        waitlistPosition: 3,
        managementUrl: 'https://example.com/manage',
        organizerBrandName: 'Dragon Martial Arts',
      };

      const { subject, html } = waitlistNotificationEmail(params);

      expect(subject).toContain('Waitlist Confirmation');
      expect(subject).toContain('Fall Classic');
      expect(html).toContain('Alice Smith');
      expect(html).toContain('Dragon Martial Arts');
      expect(html).toContain('#3');
      expect(html).toContain('added to the waitlist');
      // Should use organizer brand in header
      expect(html).toContain('<h1>Dragon Martial Arts</h1>');
      expect(html).not.toContain('<h1>bowin</h1>');
    });
  });

  describe('waitlistPromotionEmail', () => {
    it('generates promotion email with confirmation code', () => {
      const params = {
        competitorName: 'Bob Johnson',
        tournamentName: 'Winter Challenge',
        tournamentDate: new Date('2026-12-10'),
        confirmationCode: 'PROMO123',
        managementUrl: 'https://example.com/manage',
        organizerBrandName: 'Tiger Dojo',
      };

      const { subject, html } = waitlistPromotionEmail(params);

      expect(subject).toContain('A Spot Opened Up!');
      expect(subject).toContain('Winter Challenge');
      expect(html).toContain('Bob Johnson');
      expect(html).toContain('Tiger Dojo');
      expect(html).toContain('PROMO123');
      expect(html).toContain('promoted from the waitlist');
      expect(html).toContain('Your registration is now active');
      // Should use organizer brand in header
      expect(html).toContain('<h1>Tiger Dojo</h1>');
      expect(html).not.toContain('<h1>bowin</h1>');
    });
  });
});
