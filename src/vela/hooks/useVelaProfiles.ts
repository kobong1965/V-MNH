import { useCallback, useEffect, useState } from 'react';

import { listVelaProfiles, type VelaProfile } from '../services/profileService';

export function useVelaProfiles() {
  const [profiles, setProfiles] = useState<VelaProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listVelaProfiles();
      setProfiles(next);
      setError(null);
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取账户失败');
      return [];
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { profiles, error, refresh };
}
