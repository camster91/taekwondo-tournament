process.env.NODE_ENV = 'test';
process.env.ENABLE_E2E_STATIC_SERVER = '1';
process.env.ENABLE_DEMO_LOGIN = '1';
process.env.DEMO_ISOLATED_DATA = '1';
process.env.RATE_LIMIT_DISABLED = '1';
process.env.JWT_SECRET ||= 'e2e-only-production-shell-secret-never-deploy';
process.env.OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64 ||= 'MC4CAQAwBQYDK2VwBCIEIF+AFB+3Z5O46eyYKsjJexVLlARghFYReMMzRp6ig6sO';
process.env.REGISTRATION_CONSENT_VERSION ||= 'e2e-consent-v1';
process.env.PRIVACY_NOTICE_URL ||= 'https://example.invalid/privacy';
process.env.TOURNAMENT_TERMS_URL ||= 'https://example.invalid/tournament-terms';
const appOrigin = `http://localhost:${process.env.PORT || '5180'}`;
process.env.PUBLIC_APP_URL ||= appOrigin;
process.env.ALLOWED_ORIGINS ||= appOrigin;
process.env.MAILGUN_API_KEY ||= 'e2e-mailgun-key-not-used';
process.env.MAILGUN_DOMAIN ||= 'example.invalid';
process.env.EMAIL_FROM_ADDRESS ||= 'e2e@example.invalid';
process.env.METRICS_TOKEN ||= 'e2e-production-shell-metrics-token';

await import('../server.js');
