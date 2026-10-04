import { useEffect, useState } from 'react';

/** Horloge locale à la seconde, pour faire défiler les comptes à rebours sans toucher au store. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
