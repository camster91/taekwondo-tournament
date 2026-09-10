import { useQuery } from '@tanstack/react-query';
import { getAuthHeaders } from '../context/AuthContext';

type OrganizationData = {
  id: string;
  name: string;
  plan: string;
};

async function fetchOrganization(): Promise<OrganizationData | null> {
  const response = await fetch('/api/auth/me', {
    headers: getAuthHeaders(),
  });
  if (!response.ok) return null;
  const data = await response.json();
  
  // Extract organization from membership if present
  if (data.memberships && data.memberships.length > 0) {
    const membership = data.memberships[0];
    return {
      id: membership.organization.id,
      name: membership.organization.name,
      plan: membership.organization.plan,
    };
  }
  return null;
}

export function useOrganizationPlan() {
  return useQuery({
    queryKey: ['organization-plan'],
    queryFn: fetchOrganization,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });
}
