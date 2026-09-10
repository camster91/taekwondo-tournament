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

interface BrandingOptions {
  organizerBrandName?: string;
  brandPrimaryColor?: string;
  brandLogoUrl?: string;
}

/**
 * Calculate a darker shade of a hex color for hover states.
 * Simple approach: reduce RGB values by 15%.
 */
function darkenColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const darken = (c: number) => Math.max(0, Math.floor(c * 0.85));
  const toHex = (c: number) => c.toString(16).padStart(2, '0');
  return `#${toHex(darken(r))}${toHex(darken(g))}${toHex(darken(b))}`;
}

function layout(content: string, branding?: BrandingOptions): string {
  const displayName = branding?.organizerBrandName || 'bowin';
  const primaryColor = branding?.brandPrimaryColor || BRAND_RED;
  const primaryColorDark = darkenColor(primaryColor);
  const logoUrl = branding?.brandLogoUrl;
  const tagline = branding?.organizerBrandName 
    ? 'Tournament Registration Confirmation'
    : 'Tournaments, run like a black belt.';
  
  // Logo section (if provided)
  const logoHtml = logoUrl 
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(displayName)}" style="max-height: 60px; max-width: 200px; display: block; margin: 0 auto 12px;" />`
    : '';
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(displayName)}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style>
    body { 
      margin: 0; 
      padding: 0; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      background: ${BRAND_PAPER}; 
      color: ${BRAND_SLATE}; 
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { 
      background: ${BRAND_INK}; 
      padding: 32px 24px; 
      text-align: center; 
      border-radius: 12px 12px 0 0; 
      border-bottom: 4px solid ${primaryColor}; 
    }
    .header h1 { 
      color: #fff; 
      margin: 0; 
      font-size: 26px; 
      font-weight: 700; 
      letter-spacing: -0.02em; 
      line-height: 1.2;
    }
    .header .tag { 
      color: ${primaryColor}; 
      font-size: 11px; 
      font-weight: 600; 
      letter-spacing: 0.18em; 
      text-transform: uppercase; 
      margin-top: 8px; 
      display: block; 
    }
    .body { 
      background: #fff; 
      padding: 36px 28px; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    .footer { 
      background: ${BRAND_PAPER}; 
      padding: 20px 24px; 
      text-align: center; 
      font-size: 13px; 
      color: ${BRAND_MUTED}; 
      border-radius: 0 0 12px 12px; 
      border-top: 1px solid #E5E7EB; 
      line-height: 1.5;
    }
    .footer p { margin: 0; }
    .btn { 
      display: inline-block; 
      padding: 14px 40px; 
      background: ${primaryColor}; 
      color: #fff !important; 
      text-decoration: none; 
      border-radius: 8px; 
      font-weight: 600; 
      font-size: 16px; 
      letter-spacing: 0.01em;
      transition: background 0.2s ease;
    }
    .btn:hover { background: ${primaryColorDark}; }
    p { 
      color: ${BRAND_SLATE}; 
      line-height: 1.65; 
      margin: 0 0 18px; 
      font-size: 15px;
    }
    .muted { 
      color: ${BRAND_MUTED}; 
      font-size: 14px; 
      line-height: 1.5;
    }
    strong { color: ${BRAND_INK}; font-weight: 600; }
    
    /* Mobile responsive */
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 12px; }
      .header { padding: 24px 20px; border-radius: 8px 8px 0 0; }
      .header h1 { font-size: 22px; }
      .body { padding: 28px 20px; }
      .btn { padding: 12px 32px; font-size: 15px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      ${logoHtml}
      <h1>${escapeHtml(displayName)}</h1>
      <span class="tag">${escapeHtml(tagline)}</span>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>${branding?.organizerBrandName ? escapeHtml(branding.organizerBrandName) : 'bowin &middot; tournament management for martial arts schools'}</p>
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
    `, undefined), // No branding for invitations (internal)
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
    `, undefined), // No branding for magic-link (internal auth)
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
    `, undefined), // No branding for welcome (internal)
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
  brandPrimaryColor?: string;
  brandLogoUrl?: string;
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
    ? `<p style="margin: 6px 0;"><strong>Location:</strong> ${escapeHtml(params.tournamentLocation)}</p>` 
    : '';

  return {
    subject: `Registration Confirmed — ${safeTournamentName}`,
    html: layout(`
      <p>${greeting}</p>
      <p><strong>${safeCompetitorName}</strong> has been successfully registered for <strong>${safeTournamentName}</strong>.</p>
      <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px; padding: 20px; margin: 20px 0;">
        <p style="margin: 6px 0; font-size: 15px;"><strong>Tournament:</strong> ${safeTournamentName}</p>
        <p style="margin: 6px 0; font-size: 15px;"><strong>Hosted by:</strong> ${safeBrandName}</p>
        <p style="margin: 6px 0; font-size: 15px;"><strong>Date:</strong> ${escapeHtml(tournamentDate)}</p>
        ${locationLine}
        <p style="margin: 6px 0; font-size: 15px;"><strong>Events:</strong> ${safeEvents}</p>
        <p style="margin: 6px 0; font-size: 15px;"><strong>Age Group:</strong> ${safeAgeGroup}</p>
        <p style="margin: 6px 0; font-size: 15px;"><strong>Confirmation Code:</strong> <span style="font-family:monospace; background:#fff; padding:6px 10px; border-radius:6px; border: 1px solid #D1D5DB; font-weight: 600;">${safeConfirmationCode}</span></p>
      </div>
      <p style="text-align:center; margin: 28px 0;">
        <a href="${safeManagementUrl}" class="btn">Manage Registration</a>
      </p>
      <p class="muted">You can use the link above to update details or withdraw this registration before the tournament starts.</p>
      <p class="muted">Please keep this email for your records. You may be asked to provide your confirmation code at check-in.</p>
    `, {
      organizerBrandName: params.organizerBrandName,
      brandPrimaryColor: params.brandPrimaryColor,
      brandLogoUrl: params.brandLogoUrl,
    }),
  };
}

// P2-14: COPPA parental consent verification email
export function parentalConsentVerificationEmail(params: {
  parentName?: string;
  competitorName: string;
  tournamentName: string;
  tournamentDate: Date;
  verificationUrl: string;
  code: string;
  organizerBrandName?: string;
  brandPrimaryColor?: string;
  brandLogoUrl?: string;
}): { subject: string; html: string } {
  const greeting = params.parentName ? `Hi ${escapeHtml(params.parentName)},` : 'Hi,';
  const safeCompetitorName = escapeHtml(params.competitorName);
  const safeTournamentName = escapeHtml(params.tournamentName);
  const safeVerificationUrl = escapeHtml(params.verificationUrl);
  const safeCode = escapeHtml(params.code);
  const tournamentDate = new Date(params.tournamentDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return {
    subject: `Verify parental consent for ${safeTournamentName}`,
    html: layout(`
      <p>${greeting}</p>
      <p>A registration has been submitted for <strong>${safeCompetitorName}</strong> (under 18) to compete in <strong>${safeTournamentName}</strong> on ${escapeHtml(tournamentDate)}.</p>
      <p><strong>Please verify that you are the parent or legal guardian and authorize this registration by clicking the button below:</strong></p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="${safeVerificationUrl}" class="btn">Verify Consent</a>
      </p>
      <p class="muted">If you cannot click the button, you can verify by entering this code on the registration page:</p>
      <div style="text-align:center; margin: 18px 0;">
        <span style="font-family:monospace; font-size:24px; font-weight:700; background:#F9FAFB; border: 1px solid #E5E7EB; padding:10px 18px; border-radius:8px; display:inline-block; color: ${BRAND_INK};">${safeCode}</span>
      </div>
      <p class="muted">This verification link expires in 48 hours. If you did not register your child for this tournament, please disregard this email.</p>
      <p class="muted" style="word-break:break-all;">Or copy this link: ${safeVerificationUrl}</p>
    `, {
      organizerBrandName: params.organizerBrandName,
      brandPrimaryColor: params.brandPrimaryColor,
      brandLogoUrl: params.brandLogoUrl,
    }),
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
    `, {
      organizerBrandName: params.organizerBrandName,
      brandPrimaryColor: undefined,
      brandLogoUrl: undefined,
    }),
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
    `, {
      organizerBrandName: params.organizerBrandName,
      brandPrimaryColor: undefined,
      brandLogoUrl: undefined,
    }),
  };
}

export function paymentFailedEmail(params: {
  organizationName: string;
  gracePeriodDays: number;
  billingPortalUrl: string;
  failureReason?: string;
}): { subject: string; html: string } {
  const content = `
    <p>Hi there,</p>
    <p>We were unable to process the payment for <strong>${escapeHtml(params.organizationName)}</strong>.</p>
    ${params.failureReason ? `<p class="muted">Reason: ${escapeHtml(params.failureReason)}</p>` : ''}
    <p>Your account will remain active for the next <strong>${params.gracePeriodDays} days</strong> while you update your payment method.</p>
    <p>After the grace period expires, your account will be automatically downgraded to the free tier.</p>
    <p style="margin: 28px 0; text-align: center;">
      <a href="${escapeHtml(params.billingPortalUrl)}" class="btn">Update Payment Method</a>
    </p>
    <p class="muted">If you have any questions, please reply to this email or contact our support team.</p>
  `;
  
  return {
    subject: `Payment Failed — ${escapeHtml(params.organizationName)}`,
    html: layout(content),
  };
}
