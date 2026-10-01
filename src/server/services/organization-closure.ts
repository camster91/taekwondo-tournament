type OrganizationDeletionInput = {
  slug: string;
  confirmation: unknown;
  exportAcknowledged: unknown;
  billingStatus: string | null;
  /** Stripe subscription id on the billing row, when one exists. */
  providerSubscriptionId?: string | null;
};

const DELETABLE_BILLING_STATUSES = ['inactive', 'canceled', 'incomplete_expired'];

function billingAllowsDeletion(status: string | null, providerSubscriptionId: string | null | undefined): boolean {
  if (!status || DELETABLE_BILLING_STATUSES.includes(status)) return true;
  // Rows written by an abandoned checkout before the webhook ever saw a
  // subscription (older builds stored 'incomplete' at checkout creation).
  return status === 'incomplete' && !providerSubscriptionId;
}

type OrganizationDeletionResult =
  | { ok: true }
  | { ok: false; status: 400 | 409; error: string };

export function validateOrganizationDeletion(
  input: OrganizationDeletionInput,
): OrganizationDeletionResult {
  if (input.confirmation !== input.slug || input.exportAcknowledged !== true) {
    return {
      ok: false,
      status: 400,
      error: 'Confirm the organization URL and acknowledge the data export before permanent deletion.',
    };
  }
  if (!billingAllowsDeletion(input.billingStatus, input.providerSubscriptionId)) {
    return {
      ok: false,
      status: 409,
      error: 'Cancel the active subscription and wait for Stripe confirmation before deleting this organization.',
    };
  }
  return { ok: true };
}
