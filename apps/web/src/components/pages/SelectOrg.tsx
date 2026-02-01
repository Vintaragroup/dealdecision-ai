import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { OrganizationList, useAuth } from '@clerk/clerk-react';

export function SelectOrg() {
  const navigate = useNavigate();
  const { isLoaded, orgId } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (orgId) {
      navigate('/app', { replace: true });
    }
  }, [isLoaded, navigate, orgId]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white px-6 py-10 flex items-start justify-center">
      <div className="w-full max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Select or create an organization</h1>
        <p className="text-white/70">
          You need an active organization to use DealDecision AI.
        </p>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <OrganizationList
            hidePersonal
            afterSelectOrganizationUrl="/app"
            afterCreateOrganizationUrl="/app"
          />
        </div>
      </div>
    </div>
  );
}
