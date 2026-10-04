import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LogIn, RefreshCw, Settings2 } from 'lucide-react';
import { Brand } from '../ui/Brand';
import { Card } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { formatLeft } from '../ui/format';
import { useNow } from '../ui/useNow';
import { describeVoteError } from '../azuriom/errors';
import { openExternal, openPanel, setPendingQueue, setPendingTab } from '../platform';
import { isAvailable, useAccountStore, useVoteStore } from '../store/store';
import { VOTES_URL } from '../sync/limeris';
import { syncFromScreen } from '../ui/accountActions';

/**
 * Fenêtre de l'icône : le résumé seulement. Elle se ferme dès qu'on clique ailleurs, donc la file
 * de vote ne peut pas y vivre — « Voter » la confie au panneau latéral, qui reste ouvert.
 */
export function Popup() {
  const servers = useVoteStore((s) => s.servers);
  const currentId = useVoteStore((s) => s.currentId);
  const setCurrent = useVoteStore((s) => s.setCurrent);
  const now = useNow();

  // Connu d'avance : l'ouverture du panneau doit partir directement du clic, sans attente.
  const windowId = useRef<number | undefined>(undefined);
  useEffect(() => {
    chrome.windows.getCurrent().then((w) => (windowId.current = w.id));
  }, []);

  function showPanel() {
    openPanel(windowId.current).then(() => window.close());
  }

  function showSettings() {
    setPendingTab('settings');
    showPanel();
  }

  const server = servers.find((s) => s.id === currentId) ?? servers[0];

  function vote(siteIds: string[]) {
    setPendingQueue({ serverId: server.id, siteIds });
    showPanel();
  }

  if (!server) {
    return (
      <div className="flex w-[340px] flex-col gap-3 p-3">
        <Brand />
        <Card className="flex flex-col gap-3 p-4">
          <p className="text-sm text-text">Aucun serveur pour l'instant.</p>
          <p className="text-xs text-text-muted">
            Ajoute le site de ton serveur et ton pseudo : Limeris te prévient dès qu'un site de vote redevient
            disponible.
          </p>
          <div>
            <Button onClick={showPanel}>Ajouter un serveur</Button>
          </div>
        </Card>
        <AccountBar onConnect={showSettings} />
      </div>
    );
  }

  const sorted = [...server.sites].sort(
    (a, b) => Number(isAvailable(b, now)) - Number(isAvailable(a, now)) || (a.nextAt ?? 0) - (b.nextAt ?? 0)
  );
  const ready = sorted.filter((s) => isAvailable(s, now));
  const nextSite = sorted.find((s) => !isAvailable(s, now));

  return (
    <div className="flex w-[340px] flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <Brand />
        <button type="button" onClick={showSettings} className="flex shrink-0 items-center gap-1 text-xs text-accent">
          <Settings2 size={13} /> Paramètres
        </button>
      </div>

      {servers.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {servers.map((s) => {
            const count = s.sites.filter((site) => isAvailable(site, now)).length;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setCurrent(s.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  s.id === server.id ? 'border-accent bg-accent-soft text-text' : 'border-border text-text-muted hover:text-text'
                }`}
              >
                {s.name} <span className="font-mono text-text-muted">· {count}</span>
              </button>
            );
          })}
        </div>
      )}

      <Card className="flex flex-col gap-2 p-4">
        <div>
          <p className="text-lg font-semibold text-text">
            {ready.length > 0
              ? `${ready.length} vote${ready.length > 1 ? 's' : ''} disponible${ready.length > 1 ? 's' : ''}`
              : 'Tout est voté'}
          </p>
          <p className="text-xs text-text-muted">
            {nextSite?.nextAt
              ? `Prochain dans ${formatLeft(nextSite.nextAt - now)} · ${nextSite.host}`
              : `Tous les sites sont disponibles · ${server.name}`}
          </p>
        </div>
        {ready.length > 0 && (
          <div>
            <Button onClick={() => vote(ready.map((s) => s.id))}>
              {ready.length > 1 ? `Voter les ${ready.length} à la suite` : 'Voter maintenant'}
            </Button>
          </div>
        )}
      </Card>

      {server.error && <p className="text-xs text-red-500">{describeVoteError(server.error)}</p>}

      <Card className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto px-4 py-1">
        {sorted.map((site) => {
          const available = isAvailable(site, now);
          return (
            <div key={site.id} className="flex items-center gap-2 py-2">
              <p className="min-w-0 flex-1 break-words text-xs font-medium text-text">{site.host}</p>
              {available ? (
                <button type="button" onClick={() => vote([site.id])} className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Disponible
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => vote([site.id])}
                  title="Ouvrir ce site quand même"
                  className="font-mono text-xs tabular-nums text-text-muted hover:text-text"
                >
                  dans {formatLeft((site.nextAt ?? now) - now)}
                </button>
              )}
            </div>
          );
        })}
      </Card>

      <AccountBar onConnect={showSettings} />
    </div>
  );
}

/** Pied de la fenêtre : accès à limeris.fr/votes, et synchronisation ou connexion au compte. */
function AccountBar({ onConnect }: { onConnect: () => void }) {
  const account = useAccountStore((s) => s.account);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setSyncing(true);
    setError(null);
    setError(await syncFromScreen());
    setSyncing(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => openExternal(VOTES_URL)} className="flex-1 px-3 py-1.5 text-xs">
          <ExternalLink size={13} /> limeris.fr/votes
        </Button>
        {account ? (
          <Button variant="secondary" onClick={sync} disabled={syncing} className="flex-1 px-3 py-1.5 text-xs">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> Synchroniser
          </Button>
        ) : (
          // La connexion demande une autorisation au navigateur, ce qui fermerait cette fenêtre :
          // elle se fait depuis les Paramètres, dans le panneau.
          <Button variant="secondary" onClick={onConnect} className="flex-1 px-3 py-1.5 text-xs">
            <LogIn size={13} /> Se connecter
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
