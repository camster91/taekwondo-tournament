// Steps of the first-login tour (Tour.tsx). Plain data so tests can read
// them without loading React.

export interface TourStep {
  /** CSS selector for the element to highlight */
  selector: string;
  title: string;
  body: string;
  /** Preferred popover position relative to the highlighted element.
   *  Auto-falls-back if it would clip off-screen. */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional route hint: tour waits for this path before checking the selector. */
  route?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="dashboard-hero"]',
    title: 'Welcome to your tournament manager',
    body: 'This 6-step tour shows you how to run a real tournament end-to-end. You\'ll see where the 4 main workflows live: creating a tournament, importing competitors, scoring matches on the day, and sharing the live scoreboard with spectators. Press Next to advance, Back to revisit, or Escape to close the tour.',
    position: 'bottom',
  },
  {
    selector: 'a[href="/tournaments"]',
    title: 'Tournaments list',
    body: 'Every tournament you create lives here. Click any card to open it. Draft tournaments can\'t accept registrations — flip the status to "Registration" from the detail page when you\'re ready to share the public sign-up link with parents.',
    position: 'right',
  },
  {
    selector: '[data-tour="tournament-detail-actions"]',
    title: 'Tournament detail — your control center',
    body: 'From here you: (1) Import competitors from Excel or add them manually, (2) Auto-generate divisions by age/belt/weight, (3) Generate brackets, and (4) Run the day-of. The "View Public" button opens the read-only scoreboard in a new tab — useful for checking what spectators will see without logging out.',
    position: 'bottom',
  },
  {
    selector: '[data-tour="nav-scorekeeper"]',
    title: 'Scorekeeper — runs the day',
    body: 'Pick a division, then click competitor 1 or 2 to mark a winner. Keyboard shortcuts make this much faster: 1/2 = pick winner, ←/→ = navigate matches, Enter = confirm, Esc = back, ? = help. With a few hours of practice you can score a whole division without leaving the keyboard.',
    position: 'right',
  },
  {
    selector: '[data-tour="public-display"]',
    title: 'Public scoreboard — for spectators',
    body: 'Connect a laptop to the venue TV and open this URL. Auto-refreshes every 3 seconds, no login required for spectators. Generate a shareable link from Settings → Share Link to give to people who want to follow along on their phones. Parents stuck at work really appreciate this.',
    position: 'top',
  },
  {
    selector: '[data-tour="settings-share-link"]',
    title: 'Settings + share link',
    body: 'Settings is split into two tabs: Setup (quick) for things you change per tournament, like the registration fee note and the share link, and Categorization + Brackets (advanced) for the rules engine that decides how competitors get grouped. Default rules work for most dojangs — only change them if you know what you\'re doing. When you\'re done with the tour, click "Import competitors" from the tournament detail page to get started.',
    position: 'left',
  },
];
