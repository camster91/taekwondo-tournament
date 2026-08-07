# Security policy

Report suspected vulnerabilities privately to the repository owner rather than opening a public issue. Do not include competitor or parent personal information in reports.

## Dependency exception

As of 2026-08-07, `npm audit` reports `GHSA-qwww-vcr4-c8h2` through `react-router-dom@7.18.2`. The advisory concerns React Server Components action handling. This application is a Vite single-page application using `BrowserRouter`; it does not enable React Router framework mode, RSC routes, server loaders, or server actions. The affected runtime is therefore not reachable in this deployment architecture.

Earlier React Router releases contain broader XSS, redirect, denial-of-service, and deserialization advisories, so downgrading would increase exposure. The project remains pinned to 7.18.2 and this exception must be removed as soon as an advisory-free compatible release is available. CI continues to fail on critical advisories, while maintainers must review the full `npm audit` output during dependency updates.
