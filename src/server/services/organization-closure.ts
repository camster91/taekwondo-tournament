type OrganizationDeletionInput = {
  slug: string;
  confirmation: unknown;
  exportAcknowledged: unknown;
  billingStatus: string | null;
};

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
  if (input.billingStatus && !['inactive', 'canceled'].includes(input.billingStatus)) {
    return {
      ok: false,
      status: 409,
      error: 'Cancel the active subscription and wait for Stripe confirmation before deleting this organization.',
    };
  }
  return { ok: true };
}
