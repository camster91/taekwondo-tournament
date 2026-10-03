import { describe, expect, it } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { allowCrossOriginFraming, buildShareLinks, isEmbeddableRegisterRequest } from './share-links.js';

const base = {
  publicAppUrl: 'https://app.bowin.test/',
  tournamentId: '11111111-2222-3333-4444-555555555555',
  tournamentName: 'Spring "Open" <2027>',
  portalPublished: false,
  eventSlug: null,
  orgSlug: null,
  customDomainHostname: null,
};

describe('buildShareLinks', () => {
  it('links straight to the registration form when nothing else is set up', () => {
    const links = buildShareLinks(base);
    expect(links.kind).toBe('direct');
    expect(links.registerUrl).toBe('https://app.bowin.test/register?tournament=11111111-2222-3333-4444-555555555555');
    expect(links.embedUrl).toBe('https://app.bowin.test/register?tournament=11111111-2222-3333-4444-555555555555&embed=1');
    expect(links.organizerPageUrl).toBeNull();
  });

  it('uses the organizer event page when the tournament is published there', () => {
    const links = buildShareLinks({ ...base, portalPublished: true, orgSlug: 'newton-tkd', eventSlug: 'spring-open' });
    expect(links.kind).toBe('event_page');
    expect(links.registerUrl).toBe('https://app.bowin.test/events/newton-tkd/spring-open');
    expect(links.embedUrl).toBe('https://app.bowin.test/register?portal=newton-tkd/spring-open&embed=1');
    expect(links.organizerPageUrl).toBe('https://app.bowin.test/events/newton-tkd');
  });

  it('ignores the event page while the tournament is not published', () => {
    const links = buildShareLinks({ ...base, orgSlug: 'newton-tkd', eventSlug: 'spring-open' });
    expect(links.registerUrl).toContain('/register?tournament=');
    expect(links.organizerPageUrl).toBe('https://app.bowin.test/events/newton-tkd');
  });

  it('prefers the organizer’s own custom domain', () => {
    const links = buildShareLinks({
      ...base,
      portalPublished: true,
      orgSlug: 'newton-tkd',
      eventSlug: 'spring-open',
      customDomainHostname: 'Register.NewtonTKD.ca',
    });
    expect(links.kind).toBe('custom_domain');
    expect(links.registerUrl).toBe('https://register.newtontkd.ca/events/newton-tkd/spring-open');
    expect(links.organizerPageUrl).toBe('https://register.newtontkd.ca/');
    expect(links.customDomainHostname).toBe('register.newtontkd.ca');
  });

  it('falls back to the app address for a malformed hostname', () => {
    const links = buildShareLinks({ ...base, customDomainHostname: 'evil.test/"><script>' });
    expect(links.kind).toBe('direct');
    expect(links.registerUrl.startsWith('https://app.bowin.test/')).toBe(true);
  });

  it('escapes the tournament name in the embed snippet', () => {
    const { embedCode } = buildShareLinks(base);
    expect(embedCode).toContain('<iframe src="https://app.bowin.test/register?tournament=11111111-2222-3333-4444-555555555555&amp;embed=1"');
    expect(embedCode).toContain('title="Register for Spring &quot;Open&quot; &lt;2027&gt;"');
    expect(embedCode).not.toContain('<2027>');
  });
});

describe('embed framing', () => {
  it('only the registration form with embed=1 opts in', () => {
    expect(isEmbeddableRegisterRequest('/register', { embed: '1' })).toBe(true);
    expect(isEmbeddableRegisterRequest('/register', {})).toBe(false);
    expect(isEmbeddableRegisterRequest('/login', { embed: '1' })).toBe(false);
    expect(isEmbeddableRegisterRequest('/register', { embed: ['1', '1'] })).toBe(false);
  });

  it('lifts helmet’s same-origin framing rule for that response only', async () => {
    const app = express();
    app.use(helmet());
    app.get('/register', (req, res) => {
      if (isEmbeddableRegisterRequest(req.path, req.query as Record<string, unknown>)) allowCrossOriginFraming(res);
      res.send('ok');
    });
    const framed = await request(app).get('/register?embed=1');
    expect(framed.headers['x-frame-options']).toBeUndefined();
    expect(framed.headers['content-security-policy']).toContain('frame-ancestors *');
    expect(framed.headers['content-security-policy']).not.toContain("frame-ancestors 'self'");

    const normal = await request(app).get('/register');
    expect(normal.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(normal.headers['content-security-policy']).toContain("frame-ancestors 'self'");
  });
});
