export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// bowin brand palette
//   Ink         #0F172A   primary background / text
//   Belt red    #DC2626   accent (links, primary CTA, brand bar)
//   Dobok white #FAFAF9   body background
//   Slate body  #475569   secondary text
const BRAND_INK = '#0F172A';
const BRAND_RED = '#DC2626';
const BRAND_RED_DARK = '#B91C1C';
const BRAND_PAPER = '#FAFAF9';
const BRAND_SLATE = '#475569';
const BRAND_MUTED = '#94A3B8';

function layout(content: string, organizerBrandName?: string): string {
  const displayName = organizerBrandName || 'bowin';
  const tagline = organizerBrandName 
    ? 'Tournament Registration Confirmation'
    : 'Tournaments, run like a black belt.';
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: ${BRAND_PAPER}; color: ${BRAND_SLATE}; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${BRAND_INK}; padding: 28px 24px; text-align: center; border-radius: 12px 12px 0 0; border-bottom: 3px solid ${BRAND_RED}; }
    .header h1 { color: #fff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
    .header .tag { color: ${BRAND_RED}; font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; margin-top: 4px; display: block; }
    .body { background: #fff; padding: 32px 24px; }
    .footer { background: ${BRAND_PAPER}; padding: 18px 24px; text-align: center; font-size: 12px; color: ${BRAND_MUTED}; border-radius: 0 0 12px 12px; border-top: 1px solid #E5E7EB; }
    .footer p { margin: 0; }
    .btn { display: inline-block; padding: 13px 36px; background: ${BRAND_RED}; color: #fff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; letter-spacing: 0.01em; }
    .btn:hover { background: ${BRAND_RED_DARK}; }
    p { color: ${BRAND_SLATE}; line-height: 1.6; margin: 0 0 16px; }
    .muted { color: ${BRAND_MUTED}; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${escapeHtml(displayName)}</h1>
      <span class="tag">${escapeHtml(tagline)}</span>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>${organizerBrandName ? escapeHtml(organizerBrandName) : 'bowin &middot; tournament management for martial arts schools'}</p>
    </div>
  </div>
</body>
</html>`;
}

export function invitationEmail(params: {
  recipientName?: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
  expiresInHours: number;
}): { subject: string; html: string } {
  const safeName = params.recipientName ? escapeHtml(params.recipientName) : '';
  const greeting = safeName ? `Hi ${safeName},` : 'Hi,';
  const safeInviterName = escapeHtml(params.inviterName);
  const safeRole = escapeHtml(params.role.charAt(0).toUpperCase() + params.role.slice(1));
  const safeInviteUrl = escapeHtml(params.inviteUrl);

  return {
    subject: "You've been invited to bowin",
    html: layout(`
      <p>${greeting}</p>
      <p><strong>${safeInviterName}</strong> has invited you to join bowin as a <strong>${safeRole}</strong>.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${safeInviteUrl}" class="btn">Accept Invitation</a>
      </p>
      <p class="muted">This invitation expires in ${params.expiresInHours} hours. If you didn't expect this invitation, you can safely ignore this email.</p>
      <p class="muted" style="word-break:break-all;">Or copy this link: ${safeInviteUrl}</p>
    `),
  };
}

export function magicLinkEmail(params: {
  recipientName?: string;
  magicUrl: string;
  code: string;
}): { subject: string; html: string } {
  const safeName = params.recipientName ? escapeHtml(params.recipientName) : '';
  const greetingMagic = safeName ? `Hi ${safeName},` : 'Hi,';
  const safeMagicUrl = escapeHtml(params.magicUrl);
  const safeCode = escapeHtml(params.code);

  return {
    subject: 'Sign in to bowin',
    html: layout(`
      <p>${greetingMagic}</p>
      <p>Click the button below to sign in to your account.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${safeMagicUrl}" class="btn">Sign In</a>
      </p>
      <p style="text-align:center; margin: 0 0 8px;">Or enter this code:</p>
      <p style="text-align:center; margin: 0 0 24px;">
        <span style="display:inline-block; font-size:32px; font-weight:700; letter-spacing:8px; font-family:monospace; background:#F1F5F9; padding:12px 24px; border-radius:8px; color:${BRAND_INK};">${safeCode}</span>
      </p>
      <p class="muted">This link and code expire in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      <p class="muted" style="word-break:break-all;">Or copy this link: ${safeMagicUrl}</p>
    `),
  };
}

export function welcomeEmail(params: {
  recipientName: string;
  role: string;
  loginUrl: string;
}): { subject: string; html: string } {
  const safeRecipientName = escapeHtml(params.recipientName);
  const safeWelcomeRole = escapeHtml(params.role.charAt(0).toUpperCase() + params.role.slice(1));
  const safeLoginUrl = escapeHtml(params.loginUrl);

  return {
    subject: 'Welcome to bowin',
    html: layout(`
      <p>Hi ${safeRecipientName},</p>
      <p>Your account has been created! You now have <strong>${safeWelcomeRole}</strong> access to bowin.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${safeLoginUrl}" class="btn">Go to Dashboard</a>
      </p>
      <p class="muted">You can log in anytime using the email address this message was sent to.</p>
    `),
  };
}

export function registrationConfirmationEmail(params: {
  competitorName: string;
  tournamentName: string;
  tournamentDate: Date;
  tournamentLocation: string | null;
  events: string;
  ageGroup: string;
  parentName?: string;
  confirmationCode: string;
  managementUrl: string;
  organizerBrandName?: string;
}): { subject: string; html: string } {
  const safeCompetitorName = escapeHtml(params.competitorName);
  const safeTournamentName = escapeHtml(params.tournamentName);
  const safeEvents = escapeHtml(params.events);
  const safeAgeGroup = escapeHtml(params.ageGroup);
  const safeConfirmationCode = escapeHtml(params.confirmationCode);
  const safeManagementUrl = escapeHtml(params.managementUrl);
  const safeBrandName = params.organizerBrandName ? escapeHtml(params.organizerBrandName) : safeTournamentName;
  const greeting = params.parentName ? `Hi ${escapeHtml(params.parentName)},` : 'Hi,';
  
  const tournamentDate = new Date(params.tournamentDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const locationLine = params.tournamentLocation 
    ? `<p style="margin: 4px 0;"><strong>Location:</strong> ${escapeHtml(params.tournamentLocation)}</p>` 
    : '';

  return {
    subject: `Registration Confirmed — ${safeTournamentName}`,
    html: layout(`
      <p>${greeting}</p>
      <p><strong>${safeCompetitorName}</strong> has been successfully registered for <strong>${safeTournamentName}</strong>.</p>
      <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Tournament:</strong> ${safeTournamentName}</p>
        <p style="margin: 4px 0;"><strong>Hosted by:</strong> ${safeBrandName}</p>
        <p style="margin: 4px 0;"><strong>Date:</strong> ${escapeHtml(tournamentDate)}</p>
        ${locationLine}
        <p style="margin: 4px 0;"><strong>Events:</strong> ${safeEvents}</p>
        <p style="margin: 4px 0;"><strong>Age Group:</strong> ${safeAgeGroup}</p>
        <p style="margin: 4px 0;"><strong>Confirmation Code:</strong> <span style="font-family:monospace; background:#fff; padding:4px 8px; border-radius:4px;">${safeConfirmationCode}</span></p>
      </div>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${safeManagementUrl}" class="btn">Manage Registration</a>
      </p>
      <p class="muted">You can use the link above to update details or withdraw this registration before the tournament starts.</p>
      <p class="muted">Please keep this email for your records. You may be asked to provide your confirmation code at check-in.</p>
    `, params.organizerBrandName),
  };
}

export function waitlistNotificationEmail(params: {
  competitorName: string;
  tournamentName: string;
  tournamentDate: Date;
  waitlistPosition: number;
  managementUrl: string;
  organizerBrandName?: string;
}): { subject: string; html: string } {
  const safeCompetitorName = escapeHtml(params.competitorName);
  const safeTournamentName = escapeHtml(params.tournamentName);
  const safeManagementUrl = escapeHtml(params.managementUrl);
  const safeBrandName = params.organizerBrandName ? escapeHtml(params.organizerBrandName) : safeTournamentName;
  
  const tournamentDate = new Date(params.tournamentDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return {
    subject: `Waitlist Confirmation — ${safeTournamentName}`,
    html: layout(`
      <p><strong>${safeCompetitorName}</strong> has been added to the waitlist for <strong>${safeTournamentName}</strong>.</p>
      <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Tournament:</strong> ${safeTournamentName}</p>
        <p style="margin: 4px 0;"><strong>Hosted by:</strong> ${safeBrandName}</p>
        <p style="margin: 4px 0;"><strong>Date:</strong> ${escapeHtml(tournamentDate)}</p>
        <p style="margin: 4px 0;"><strong>Waitlist Position:</strong> #${params.waitlistPosition}</p>
      </div>
      <p>One or more divisions for your selected events are currently at capacity. You'll receive an email notification if a spot opens up.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${safeManagementUrl}" class="btn">Manage Registration</a>
      </p>
      <p class="muted">You can withdraw from the waitlist anytime using the link above.</p>
    `, params.organizerBrandName),
  };
}

export function waitlistPromotionEmail(params: {
  competitorName: string;
  tournamentName: string;
  tournamentDate: Date;
  confirmationCode: string;
  managementUrl: string;
  organizerBrandName?: string;
}): { subject: string; html: string } {
  const safeCompetitorName = escapeHtml(params.competitorName);
  const safeTournamentName = escapeHtml(params.tournamentName);
  const safeConfirmationCode = escapeHtml(params.confirmationCode);
  const safeManagementUrl = escapeHtml(params.managementUrl);
  const safeBrandName = params.organizerBrandName ? escapeHtml(params.organizerBrandName) : safeTournamentName;
  
  const tournamentDate = new Date(params.tournamentDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return {
    subject: `A Spot Opened Up! — ${safeTournamentName}`,
    html: layout(`
      <p>Great news! <strong>${safeCompetitorName}</strong> has been promoted from the waitlist for <strong>${safeTournamentName}</strong>.</p>
      <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Tournament:</strong> ${safeTournamentName}</p>
        <p style="margin: 4px 0;"><strong>Hosted by:</strong> ${safeBrandName}</p>
        <p style="margin: 4px 0;"><strong>Date:</strong> ${escapeHtml(tournamentDate)}</p>
        <p style="margin: 4px 0;"><strong>Confirmation Code:</strong> <span style="font-family:monospace; background:#fff; padding:4px 8px; border-radius:4px;">${safeConfirmationCode}</span></p>
      </div>
      <p>Your registration is now active. No further action is required — you're all set!</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${safeManagementUrl}" class="btn">View Registration</a>
      </p>
      <p class="muted">Please keep this email for your records. You may be asked to provide your confirmation code at check-in.</p>
    `, params.organizerBrandName),
  };
}
