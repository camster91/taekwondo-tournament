function layout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; padding: 24px; text-align: center; border-radius: 12px 12px 0 0; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body { background: #fff; padding: 32px 24px; }
    .footer { background: #f9fafb; padding: 16px 24px; text-align: center; font-size: 12px; color: #9ca3af; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb; }
    .btn { display: inline-block; padding: 12px 32px; background: #2563eb; color: #fff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; }
    .btn:hover { background: #1d4ed8; }
    p { color: #374151; line-height: 1.6; margin: 0 0 16px; }
    .muted { color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>TKD Tournament Manager</h1>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p style="margin:0;">TKD Tournament Manager</p>
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
  const greeting = params.recipientName ? `Hi ${params.recipientName},` : 'Hi,';
  const roleLabel = params.role.charAt(0).toUpperCase() + params.role.slice(1);

  return {
    subject: "You've been invited to TKD Tournament Manager",
    html: layout(`
      <p>${greeting}</p>
      <p><strong>${params.inviterName}</strong> has invited you to join TKD Tournament Manager as a <strong>${roleLabel}</strong>.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${params.inviteUrl}" class="btn">Accept Invitation</a>
      </p>
      <p class="muted">This invitation expires in ${params.expiresInHours} hours. If you didn't expect this invitation, you can safely ignore this email.</p>
      <p class="muted" style="word-break:break-all;">Or copy this link: ${params.inviteUrl}</p>
    `),
  };
}

export function passwordResetEmail(params: {
  recipientName?: string;
  resetUrl: string;
}): { subject: string; html: string } {
  const greeting = params.recipientName ? `Hi ${params.recipientName},` : 'Hi,';

  return {
    subject: 'Reset your password - TKD Tournament Manager',
    html: layout(`
      <p>${greeting}</p>
      <p>We received a request to reset your password. Click the button below to choose a new password.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${params.resetUrl}" class="btn">Reset Password</a>
      </p>
      <p class="muted">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
      <p class="muted" style="word-break:break-all;">Or copy this link: ${params.resetUrl}</p>
    `),
  };
}

export function welcomeEmail(params: {
  recipientName: string;
  role: string;
  loginUrl: string;
}): { subject: string; html: string } {
  const roleLabel = params.role.charAt(0).toUpperCase() + params.role.slice(1);

  return {
    subject: 'Welcome to TKD Tournament Manager',
    html: layout(`
      <p>Hi ${params.recipientName},</p>
      <p>Your account has been created! You now have <strong>${roleLabel}</strong> access to TKD Tournament Manager.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${params.loginUrl}" class="btn">Go to Dashboard</a>
      </p>
      <p class="muted">You can log in anytime using the email address this message was sent to.</p>
    `),
  };
}
