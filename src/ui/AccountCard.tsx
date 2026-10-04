import { useState, type FormEvent } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Card } from './components/Card';
import { Button } from './components/Button';
import { openExternal } from '../platform';
import { useAccountStore } from '../store/store';
import { CONNECT_URL, revokeToken, VOTES_URL } from '../sync/limeris';
import { connectWithCode, syncFromScreen } from './accountActions';
import { relativeTime } from './format';
import { useNow } from './useNow';

/** Compte limeris.fr : connexion par le login du site, synchronisation et accès à limeris.fr/votes. */
export function AccountCard() {
  const account = useAccountStore((s) => s.account);
  const notice = useAccountStore((s) => s.notice);
  const setAccount = useAccountStore((s) => s.setAccount);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');

  // L'accès à limeris.fr est accordé d'office à l'extension (manifeste) : rien à demander ici.
  function connect() {
    setError(null);
    openExternal(CONNECT_URL);
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const failure = await connectWithCode(code);
    setBusy(false);
    setError(failure);
    if (!failure) {
      setCode('');
      setCodeOpen(false);
    }
  }

  async function sync() {
    setBusy(true);
    setError(null);
    setError(await syncFromScreen());
    setBusy(false);
  }

  function disconnect() {
    if (!confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setConfirming(false);
    setError(null);
    // Le jeton est aussi révoqué côté limeris.fr, pour qu'il ne puisse plus servir.
    if (account) void revokeToken(account);
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
            <Button onClick={sync} disabled={busy}>
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Synchroniser
            </Button>
            <Button variant="secondary" onClick={() => openExternal(VOTES_URL)}>
              <ExternalLink size={14} /> limeris.fr/votes
            </Button>
            <Button variant="ghost" onClick={disconnect}>
              {confirming ? 'Confirmer la déconnexion ?' : 'Se déconnecter'}
            </Button>
          </div>
          <p className="text-xs text-text-muted">Tes votes partent vers ton compte tout seuls, quelques secondes après chaque changement.</p>
        </>
      ) : (
        <>
          {notice === 'revoked' && (
            <p className="rounded-lg border border-amber-500/50 px-3 py-2 text-xs text-text">
              limeris.fr ne reconnaît plus cette extension : son accès a été retiré depuis ton compte, ou il a expiré.
              Tes serveurs et tes votes restent sur cet appareil. Reconnecte-toi pour reprendre la synchronisation.
            </p>
          )}
          <p className="text-xs text-text-muted">
            Connecte ton compte limeris.fr pour retrouver tes serveurs et tes votes sur le site. La connexion se
            fait sur limeris.fr, avec ton login habituel : l'extension ne voit jamais ton mot de passe.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={connect}>Se connecter</Button>
            <Button variant="secondary" onClick={() => openExternal(VOTES_URL)}>
              <ExternalLink size={14} /> limeris.fr/votes
            </Button>
            <Button variant="ghost" onClick={() => setCodeOpen((open) => !open)} aria-expanded={codeOpen}>
              J'ai un code
            </Button>
          </div>
          {codeOpen && (
            <form onSubmit={submitCode} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Code de secours affiché sur limeris.fr
                <input
                  type="password"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="lvx_…"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text"
                  required
                />
              </label>
              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Vérification…' : 'Connecter avec ce code'}
                </Button>
              </div>
            </form>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </Card>
  );
}
