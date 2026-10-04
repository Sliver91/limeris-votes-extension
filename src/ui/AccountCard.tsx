import { useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Card } from './components/Card';
import { Button } from './components/Button';
import { openExternal, requestSiteAccess } from '../platform';
import { useAccountStore } from '../store/store';
import { CONNECT_URL, describeSyncError, LIMERIS_URL, syncNow, VOTES_URL } from '../sync/limeris';
import { relativeTime } from './format';
import { useNow } from './useNow';

/** Compte limeris.fr : connexion par le login du site, synchronisation et accès à limeris.fr/votes. */
export function AccountCard() {
  const account = useAccountStore((s) => s.account);
  const setAccount = useAccountStore((s) => s.setAccount);
  const now = useNow();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function connect() {
    setError(null);
    // La demande d'accès doit être le premier appel après le clic, sinon le navigateur la refuse.
    if (!(await requestSiteAccess(LIMERIS_URL))) {
      setError("L'extension a besoin de l'accès à limeris.fr pour se connecter à ton compte. Autorise-le, puis réessaie.");
      return;
    }
    openExternal(CONNECT_URL);
  }

  async function sync() {
    if (!account) return;
    setSyncing(true);
    setError(null);
    try {
      await syncNow(account);
      setAccount({ ...account, lastSyncAt: Date.now() });
    } catch (e) {
      setError(describeSyncError(e));
    } finally {
      setSyncing(false);
    }
  }

  function disconnect() {
    if (!confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setConfirming(false);
    setError(null);
    setAccount(null);
  }

  return (
    <Card className="flex min-w-0 flex-col gap-3 md:col-span-2">
      <h2 className="text-sm font-semibold text-text">Compte Limeris</h2>

      {account ? (
        <>
          <div>
            <p className="flex items-center gap-1.5 text-sm text-text">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              Connecté{account.pseudo && <> : <span className="font-medium">{account.pseudo}</span></>}
            </p>
            <p className="text-xs text-text-muted">
              {account.lastSyncAt ? `Synchronisé ${relativeTime(account.lastSyncAt, now)}` : 'Pas encore synchronisé'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={sync} disabled={syncing}>
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> Synchroniser
            </Button>
            <Button variant="secondary" onClick={() => openExternal(VOTES_URL)}>
              <ExternalLink size={14} /> limeris.fr/votes
            </Button>
            <Button variant="ghost" onClick={disconnect}>
              {confirming ? 'Confirmer la déconnexion ?' : 'Se déconnecter'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            Connecte ton compte limeris.fr pour retrouver tes serveurs et tes votes sur le site. La connexion se
            fait sur limeris.fr, avec ton login habituel : l'extension ne voit jamais ton mot de passe.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={connect}>Se connecter</Button>
            <Button variant="secondary" onClick={() => openExternal(VOTES_URL)}>
              <ExternalLink size={14} /> limeris.fr/votes
            </Button>
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </Card>
  );
}
