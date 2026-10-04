import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BarChart3, Plus, RefreshCw, Settings2, Vote, X } from 'lucide-react';
import { Card } from './components/Card';
import { Button } from './components/Button';
import { Switch } from './components/Switch';
import { normalizeBase } from '../azuriom/parse';
import { ERR } from '../azuriom/errors';
import { playSound, SOUNDS } from '../lib/sound';
import { onPendingQueue, onPendingTab, openExternal, requestSiteAccess, takePendingQueue, takePendingTab } from '../platform';
import { formatLeft, relativeTime } from './format';
import { describeVoteError, importServer, refreshServer } from './api';
import { isAvailable, useVoteStore, type OpenMode, type VoteServer, type VoteSound } from '../store/store';
import { useNow } from './useNow';
import { VoteQueue } from './VoteQueue';
import { StatsTab } from './StatsTab';
import { CopyPseudoButton } from './CopyPseudoButton';
import { Brand, SITE_URL, SiteLink } from './Brand';

type Tab = 'votes' | 'stats' | 'settings';

/** `short` : libellé utilisé quand l'écran est étroit (panneau latéral). */
const TABS: { id: Tab; label: string; short: string; Icon: typeof Vote }[] = [
  { id: 'votes', label: 'Votes', short: 'Votes', Icon: Vote },
  { id: 'stats', label: 'Statistiques', short: 'Stats', Icon: BarChart3 },
  { id: 'settings', label: 'Paramètres', short: 'Param.', Icon: Settings2 },
];

const BUSTER_URL = 'https://chromewebstore.google.com/detail/buster-captcha-solver-for/mpbjkejclgfgadiemmefgebjfooflfhl';

const pillClass = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
    active ? 'border-accent bg-accent-soft text-text' : 'border-border text-text-muted hover:text-text'
  }`;

const selectClass = 'rounded-lg border border-border bg-surface px-2 py-1 text-sm text-text disabled:opacity-50';
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const inputClass = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text';

function AddServerForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const addServer = useVoteStore((s) => s.addServer);
  const [address, setAddress] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // La demande d'accès doit être le premier appel après le clic, sinon le navigateur la refuse.
      const base = normalizeBase(address);
      if (!(await requestSiteAccess(base))) throw new Error(ERR.ACCESS_DENIED);
      addServer(await importServer(base, pseudo.trim()));
      onDone();
    } catch (err) {
      setError(describeVoteError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text">Ajouter un serveur</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Adresse du site du serveur
            <input
              className={inputClass}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="https://monserveur.fr"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Ton pseudo sur ce site
            <input
              className={inputClass}
              value={pseudo}
              onChange={(e) => setPseudo(e.target.value)}
              placeholder="Pseudo"
              maxLength={32}
              required
            />
          </label>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Lecture du site…' : 'Trouver les sites de vote'}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Annuler
            </Button>
          )}
        </div>
        <p className="text-xs text-text-muted">
          Fonctionne avec les sites de serveur faits avec Azuriom. Le navigateur te demandera d'autoriser l'accès à
          ce site : l'extension en a besoin pour lire sa page de vote, et ne demande l'accès à aucun autre site.
        </p>
      </form>
    </Card>
  );
}

function RemoveServerButton({ server }: { server: VoteServer }) {
  const removeServer = useVoteStore((s) => s.removeServer);
  const [confirming, setConfirming] = useState(false);

  function remove() {
    if (!confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 4000);
      return;
    }
    removeServer(server.id);
  }

  return (
    <button type="button" onClick={remove} className="text-xs text-text-muted hover:text-text">
      {confirming ? 'Confirmer le retrait ?' : 'Retirer ce serveur'}
    </button>
  );
}

function VotesTab() {
  const servers = useVoteStore((s) => s.servers);
  const currentId = useVoteStore((s) => s.currentId);
  const setCurrent = useVoteStore((s) => s.setCurrent);
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const queueRef = useRef(queue);
  queueRef.current = queue;

  // File demandée depuis la fenêtre de l'icône : on la lance, sauf si une file est déjà en cours.
  useEffect(() => {
    async function start() {
      const pending = await takePendingQueue();
      if (!pending || queueRef.current !== null) return;
      if (!useVoteStore.getState().servers.some((s) => s.id === pending.serverId)) return;
      useVoteStore.getState().setCurrent(pending.serverId);
      setAdding(false);
      setQueue(pending.siteIds);
    }
    start();
    return onPendingQueue(start);
  }, []);

  const server = servers.find((s) => s.id === currentId) ?? servers[0];

  if (!server || adding) {
    return <AddServerForm onDone={() => setAdding(false)} onCancel={server ? () => setAdding(false) : undefined} />;
  }

  async function refresh() {
    setRefreshing(true);
    await refreshServer(server.id);
    setRefreshing(false);
  }

  const sorted = [...server.sites].sort(
    (a, b) => Number(isAvailable(b, now)) - Number(isAvailable(a, now)) || (a.nextAt ?? 0) - (b.nextAt ?? 0)
  );
  const ready = sorted.filter((s) => isAvailable(s, now));
  const nextSite = sorted.find((s) => !isAvailable(s, now));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {servers.map((s) => {
          const count = s.sites.filter((site) => isAvailable(site, now)).length;
          return (
            <button
              key={s.id}
              type="button"
              disabled={queue !== null}
              onClick={() => setCurrent(s.id)}
              className={`${pillClass(s.id === server.id)} disabled:opacity-50`}
            >
              {s.name} <span className="font-mono text-text-muted">· {count}</span>
            </button>
          );
        })}
        <button
          type="button"
          disabled={queue !== null}
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-accent disabled:opacity-50"
        >
          <Plus size={14} /> Ajouter un serveur
        </button>
      </div>

      {queue ? (
        <VoteQueue server={server} siteIds={queue} onClose={() => setQueue(null)} />
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-lg font-semibold leading-tight text-text">
                {ready.length > 0
                  ? `${ready.length} vote${ready.length > 1 ? 's' : ''} disponible${ready.length > 1 ? 's' : ''}`
                  : 'Tout est voté'}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {nextSite?.nextAt ? `Prochain dans ${formatLeft(nextSite.nextAt - now)} · ${nextSite.host}` : 'Tous les sites sont disponibles.'}
              </p>
            </div>
            <Button disabled={ready.length === 0} onClick={() => setQueue(ready.map((s) => s.id))} className="grow sm:grow-0">
              {ready.length > 1 ? `Voter les ${ready.length} à la suite` : 'Voter maintenant'}
            </Button>
          </Card>

          {server.error && <p className="text-xs text-red-500">{describeVoteError(server.error)}</p>}

          {/* Le panneau latéral est étroit : le nom du site et son état sont empilés à gauche,
              seul le bouton reste à droite, pour que le nom garde sa place. */}
          <Card className="flex flex-col divide-y divide-border py-1">
            {sorted.map((site) => {
              const available = isAvailable(site, now);
              return (
                <div key={site.id} className="flex items-center gap-2 py-2 sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug text-text [overflow-wrap:anywhere] sm:text-sm" title={site.label && site.label !== site.host ? `${site.host} · ${site.label}` : site.host}>
                      {site.host}
                    </p>
                    {available ? (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /> Disponible
                      </p>
                    ) : (
                      <p className="font-mono text-xs tabular-nums text-text-muted">dans {formatLeft((site.nextAt ?? now) - now)}</p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!available}
                    onClick={() => setQueue([site.id])}
                    className="shrink-0 px-2.5 py-1.5 text-xs sm:px-3"
                  >
                    Voter
                  </Button>
                </div>
              );
            })}
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="font-mono text-text">{server.pseudo}</span>
              <CopyPseudoButton pseudo={server.pseudo} />
              {server.monthVotes !== null && <span>· {server.monthVotes} vote{server.monthVotes > 1 ? 's' : ''} ce mois</span>}
              {server.lastCheckedAt && <span>· vérifié {relativeTime(server.lastCheckedAt, now)}</span>}
            </span>
            <span className="flex items-center gap-4">
              <button type="button" onClick={refresh} disabled={refreshing} className="flex items-center gap-1 hover:text-text">
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Actualiser
              </button>
              <RemoveServerButton server={server} />
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsTab() {
  const settings = useVoteStore((s) => s.settings);
  const update = useVoteStore((s) => s.updateSettings);
  const modes: { id: OpenMode; label: string }[] = [
    { id: 'tab', label: 'Nouvel onglet' },
    { id: 'window', label: 'Petite fenêtre' },
  ];

  return (
    <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
      <Card className="flex min-w-0 flex-col gap-3">
        <h2 className="text-sm font-semibold text-text">Rappels</h2>
        <Switch checked={settings.notify} onChange={(notify) => update({ notify })} label="Prévenir dès qu'un vote est disponible" />
        <label className="flex flex-wrap items-center justify-between gap-3 text-sm text-text">
          Relancer si je n'ai pas voté
          <select
            value={settings.remindMinutes}
            onChange={(e) => update({ remindMinutes: Number(e.target.value) })}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-text"
          >
            <option value={0}>Jamais</option>
            <option value={5}>Toutes les 5 min</option>
            <option value={10}>Toutes les 10 min</option>
            <option value={30}>Toutes les 30 min</option>
            <option value={60}>Toutes les heures</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Switch checked={settings.quietNight} onChange={(quietNight) => update({ quietNight })} label="Ne pas déranger" />
          <span className="flex items-center gap-1.5 text-sm text-text">
            de
            <select
              aria-label="Début du silence"
              disabled={!settings.quietNight}
              value={settings.quietFrom}
              onChange={(e) => update({ quietFrom: Number(e.target.value) })}
              className={selectClass}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
            à
            <select
              aria-label="Fin du silence"
              disabled={!settings.quietNight}
              value={settings.quietTo}
              onChange={(e) => update({ quietTo: Number(e.target.value) })}
              className={selectClass}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Switch checked={settings.sound} onChange={(sound) => update({ sound })} label="Jouer un son" />
          <span className="flex min-w-0 items-center gap-1.5">
            <select
              aria-label="Son du rappel"
              disabled={!settings.sound}
              value={settings.soundKind}
              onChange={(e) => {
                const soundKind = e.target.value as VoteSound;
                update({ soundKind });
                playSound(soundKind, settings.volume);
              }}
              className={`min-w-0 ${selectClass}`}
            >
              {SOUNDS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => playSound(settings.soundKind, settings.volume)}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text"
            >
              Tester
            </button>
          </span>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm text-text">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            disabled={!settings.sound}
            value={settings.volume}
            onChange={(e) => update({ volume: Number(e.target.value) })}
            className="min-w-0 max-w-40 flex-1 disabled:opacity-50"
          />
        </label>
        <p className="text-xs text-text-muted">Les rappels arrivent tant que le navigateur est ouvert, même sans cet écran.</p>
      </Card>

      <Card className="flex min-w-0 flex-col gap-3">
        <h2 className="text-sm font-semibold text-text">Pendant le vote</h2>
        <div>
          <p className="mb-1.5 text-xs text-text-muted">Ouvrir les sites de vote dans</p>
          <div className="flex flex-wrap gap-2">
            {modes.map((m) => (
              <button key={m.id} type="button" onClick={() => update({ openMode: m.id })} className={pillClass(settings.openMode === m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <Switch checked={settings.chain} onChange={(chain) => update({ chain })} label="Passer seul au site suivant" />
        <div className="rounded-lg border border-border px-3 py-2.5">
          <p className="text-xs text-text">Conseil : l'extension Buster aide à passer les captchas plus vite.</p>
          <button type="button" onClick={() => openExternal(BUSTER_URL)} className="mt-1.5 text-left text-xs font-medium text-accent">
            Voir Buster sur le Chrome Web Store
          </button>
        </div>
        <p className="text-xs text-text-muted">
          Limeris ne vote pas à ta place : tu valides le captcha sur chaque site, et le site du serveur confirme
          ensuite le vote et donne la récompense.
        </p>
      </Card>

      <Card className="flex min-w-0 items-center gap-3 md:col-span-2">
        <a href={SITE_URL} target="_blank" rel="noreferrer" title="Ouvrir limeris.fr" className="shrink-0">
          <img src="icons/128.png" alt="Limeris" width={40} height={40} className="h-10 w-10 rounded-xl" />
        </a>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">
            Limeris VOTES <span className="font-mono text-xs font-normal text-text-muted">v{chrome.runtime.getManifest().version}</span>
          </p>
          <p className="text-xs text-text-muted">
            Développé par <span className="font-medium text-text">Sliver91</span> · <SiteLink />
          </p>
          <p className="text-xs text-text-muted">© 2026 Sliver91. Tous droits réservés.</p>
        </div>
      </Card>
    </div>
  );
}

export function VotesPage() {
  const [tab, setTab] = useState<Tab>('votes');

  // Une file demandée depuis la fenêtre de l'icône ramène sur l'onglet Votes, qui la lance.
  useEffect(() => onPendingQueue(() => setTab('votes')), []);

  // « Paramètres » dans la fenêtre de l'icône ouvre le panneau directement sur cet onglet.
  useEffect(() => {
    async function show() {
      const pending = await takePendingTab();
      if (pending && TABS.some((t) => t.id === pending)) setTab(pending as Tab);
    }
    show();
    return onPendingTab(show);
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3 sm:gap-5 sm:p-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <Brand />
          {/* Ferme le panneau latéral (ou l'onglet) : le bouton du navigateur n'est pas toujours visible. */}
          <button
            type="button"
            onClick={() => window.close()}
            aria-label="Fermer"
            title="Fermer"
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
          >
            <X size={14} /> Fermer
          </button>
        </div>
        {/* La phrase de présentation prendrait quatre lignes dans le panneau latéral. */}
        <p className="mt-2 hidden text-sm text-text-muted sm:block">
          Suis les sites de vote de tes serveurs et ne rate plus un vote : Limeris te prévient dès qu'un site
          redevient disponible.
        </p>
      </div>

      {/* Trois onglets de même largeur, toujours sur une seule ligne. */}
      <div className="grid grid-cols-3 gap-1.5 sm:flex sm:gap-2">
        {TABS.map(({ id, label, short, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-label={label}
            className={`flex min-w-0 items-center justify-center gap-1.5 !px-2 sm:!px-3 ${pillClass(tab === id)}`}
          >
            <Icon size={14} className="hidden shrink-0 min-[340px]:block" />
            <span className="truncate sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'votes' ? <VotesTab /> : tab === 'stats' ? <StatsTab /> : <SettingsTab />}
    </div>
  );
}
