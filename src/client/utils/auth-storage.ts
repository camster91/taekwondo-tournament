// Single source of truth for the localStorage keys the app uses to persist
// auth state. Imported by AuthContext, Login, AcceptInvite, and any future
// entry point that needs to read or write the auth session.
//
// Why a shared module instead of constants inside AuthContext:
// - Login and AcceptInvite both need to write these keys before the
//   context is hydrated, so they can't import the value from the context
//   without a chicken-and-egg.
// - The CLI helper `getAuthHeaders()` lives in AuthContext because the
//   context owns it, but the keys themselves are read everywhere via
//   raw localStorage (e.g. the API client and Playwright helpers).
// Centralising the strings here means a rename only touches one file.
//
// Historical note: these keys are still prefixed `tkd_` even though the
// app UI is rebranded to "Martial Arts Tournament Manager". Renaming
// would orphan every existing user's local session on deploy, which
// silently signs them out. Renaming needs a migration step that reads
// both keys during a transition period. See CLAUDE.md "Rebrand status".
export const AUTH_TOKEN_KEY = 'tkd_auth_token';
export const AUTH_USER_KEY = 'tkd_auth_user';
