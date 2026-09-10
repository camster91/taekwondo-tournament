import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useOrganizationPlan } from '../hooks/useOrganizationPlan';

// Crisp-based live chat widget integration (P1-16).
// Only shown to paying customers (starter/pro/per-event paid entitlements).
// Gated on VITE_CRISP_WEBSITE_ID; no-op when unset.

declare global {
  interface Window {
    $crisp?: unknown[];
    CRISP_WEBSITE_ID?: string;
  }
}

function isPaidPlan(plan: string | null | undefined): boolean {
  if (!plan) return false;
  const paid = ['starter', 'pro', 'per_event_paid', 'pilot'];
  return paid.includes(plan.toLowerCase());
}

export default function LiveChatWidget() {
  const { user } = useAuth();
  const { data: organization } = useOrganizationPlan();

  useEffect(() => {
    const websiteId = import.meta.env.VITE_CRISP_WEBSITE_ID as string | undefined;

    // Guard: only load Crisp if env var is set
    if (!websiteId || websiteId.trim() === '') {
      return;
    }

    // Guard: only show chat to paying customers
    if (!isPaidPlan(organization?.plan)) {
      return;
    }

    // Guard: must be authenticated
    if (!user) {
      return;
    }

    // Initialize Crisp
    window.$crisp = [];
    window.CRISP_WEBSITE_ID = websiteId;

    // Set user details
    const userEmail = user.email;
    const userName = `${user.firstName} ${user.lastName}`;
    
    if (userEmail) {
      window.$crisp!.push(['set', 'user:email', userEmail]);
    }
    if (userName) {
      window.$crisp!.push(['set', 'user:nickname', userName]);
    }
    if (user.role) {
      window.$crisp!.push(['set', 'session:data', [[['role', user.role]]]]);
    }
    if (organization?.name) {
      window.$crisp!.push(['set', 'session:data', [[['organization', organization.name]]]]);
    }

    // Load Crisp script
    const script = document.createElement('script');
    script.src = 'https://client.crisp.chat/l.js';
    script.async = true;
    document.head.appendChild(script);

    return () => {
      // Cleanup: remove Crisp script and widget on unmount
      script.remove();
      window.$crisp = undefined;
      window.CRISP_WEBSITE_ID = undefined;
      const crispDiv = document.querySelector('.crisp-client');
      if (crispDiv) crispDiv.remove();
    };
  }, [organization?.plan, organization?.name, user]);

  // Crisp injects its own UI; this component renders nothing
  return null;
}
