import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BarChart3, BellRing, Pencil, Plus, RefreshCw, Settings2, Vote, X } from 'lucide-react';
import { Card } from './components/Card';
import { Button } from './components/Button';
import { Switch } from './components/Switch';
import { normalizeBase } from '../azuriom/parse';
import { ERR } from '../azuriom/errors';
import { playSound, SOUNDS } from '../lib/sound';
import { appVersion, assetUrl, scheduleTestNotification, onPendingQueue, onPendingTab, openExtension, openExternal, requestSiteAccess, takePendingQueue, takePendingTab, useHost } from '../platform';
import { AccountSection } from '../account/AccountSection';
import { formatClock, formatLeft, relativeTime } from './format';
import { describeVoteError, importServer, refreshServer } from './api';
import { isAvailable, useVoteStore, type OpenMode, type VoteServer, type VoteSite, type VoteSound } from '../store/store';
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
/** Titre d'un groupe de réglages, au-dessus de sa carte. */
const groupTitleClass = 'px-1 text-xs font-semibold uppercase tracking-wider text-text-muted';
/** Une ligne de réglage : libellé à gauche, commande à droite, qui passe dessous si la place manque. */
const rowClass = 'flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5';
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

/** Affiché à la place du formulaire d'ajout quand l'hôte ne peut pas lire le site d'un serveur. */
function ExtensionNeeded({ onCancel }: { onCancel?: () => void }) {
  const host = useHost();
  const installed = host.extension === 'installed';
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text">Ajouter un serveur</h2>
      <p className="text-sm text-text-muted">
        L'ajout d'un serveur se fait depuis l'extension Limeris votes : c'est elle qui lit la page de vote du serveur,
        depuis ton navigateur. Une fois connectée à ton compte, tes serveurs apparaissent ici tout seuls.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={openExtension}>
          {installed ? "Ouvrir l'extension" : "Installer l'extension"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
        )}
      </div>
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

const timeInputClass = 'w-12 rounded-lg border border-border bg-surface px-1.5 py-1 text-base tabular-nums text-text';

/**
 * Une tuile par site de vote. Le crayon ouvre le réglage du délai : le compte à rebours peut se
 * tromper (vote fait ailleurs, délai mal lu), l'utilisateur le corrige lui-même.
 */
function SiteTile({ serverId, site, now, showTime, onVote }: { serverId: string; site: VoteSite; now: number; showTime: boolean; onVote: () => void }) {
  const patchSite = useVoteStore((s) => s.patchSite);
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('0');
  const available = isAvailable(site, now);

  function openEdit() {
    // Site en attente : le temps restant. Site disponible : le dernier délai choisi pour lui.
    const left = available ? (site.manualDelayMin ?? 0) : Math.ceil(((site.nextAt ?? now) - now) / 60_000);
    setHours(String(Math.floor(left / 60)));
    setMinutes(String(left % 60));
    setEditing(true);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const total = Math.max(0, Math.floor(Number(hours) || 0)) * 60 + Math.max(0, Math.floor(Number(minutes) || 0));
    const at = Date.now();
    const until = at + total * 60_000;
    // Comme un délai lancé à la main : il fait foi tant qu'il court (voir applyStatus).
    patchSite(
      serverId,
      site.id,
      total > 0
        ? { nextAt: until, localUntil: until, notified: false, lastRemindAt: null, updatedAt: at }
        : { nextAt: null, localUntil: null, updatedAt: at }
    );
    setEditing(false);
  }

  if (editing) {
    return (
      <form onSubmit={save} className="flex min-w-0 flex-col gap-2 rounded-xl border border-accent bg-surface p-3 shadow-sm">
        <p className="text-xs font-semibold text-text">Prochain vote dans</p>
        <p className="truncate text-xs text-text-muted">{site.host}</p>
        <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
          <input type="number" inputMode="numeric" min={0} max={72} aria-label="Heures" value={hours} onChange={(e) => setHours(e.target.value)} className={timeInputClass} />
          h
          <input type="number" inputMode="numeric" min={0} max={59} aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} className={timeInputClass} />
          min
        </div>
        <p className="text-[11px] leading-tight text-text-muted">0 : disponible maintenant.</p>
        <div className="mt-auto flex gap-1.5">
          <button type="submit" className="min-h-9 flex-1 rounded-lg bg-accent text-xs font-semibold text-[var(--accent-contrast)]">
            OK
          </button>
          <button type="button" onClick={() => setEditing(false)} className="min-h-9 flex-1 rounded-lg border border-border text-xs text-text-muted hover:text-text">
            Annuler
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={`flex min-w-0 flex-col gap-2 rounded-xl border bg-surface p-3 shadow-sm ${available ? 'border-accent' : 'border-border'}`}>
      <div className="flex items-center justify-between gap-1">
        {available ? (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" /> Disponible
          </p>
        ) : (
          <p className="text-xs text-text-muted">Revient dans</p>
        )}
        <button
          type="button"
          onClick={openEdit}
          aria-label={`Modifier le délai de ${site.host}`}
          title="Modifier le délai"
          className="-m-1.5 rounded-md p-1.5 text-text-muted hover:text-text"
        >
          <Pencil size={14} />
        </button>
      </div>
      <p
        className={`min-h-[2.5em] text-[13px] font-medium leading-tight [overflow-wrap:anywhere] sm:text-sm ${available ? 'text-text' : 'text-text-muted'}`}
        title={site.label && site.label !== site.host ? `${site.host} · ${site.label}` : site.host}
      >
        {site.host}
      </p>
      {available ? (
        <button
          type="button"
          onClick={onVote}
          className="mt-auto min-h-11 rounded-lg bg-accent-soft text-sm font-semibold text-text transition-colors hover:bg-accent hover:text-[var(--accent-contrast)]"
        >
          Voter
        </button>
      ) : (
        <>
          <div>
            <p className="font-mono text-xl font-medium tabular-nums text-text">{formatLeft((site.nextAt ?? now) - now)}</p>
            {showTime && site.nextAt !== null && <p className="text-xs text-text-muted">{formatClock(site.nextAt, now)}</p>}
          </div>
          {/* Toujours cliquable, même pendant le délai : le compte à rebours peut se tromper. */}
          <button
            type="button"
            title="Ouvrir ce site quand même"
            onClick={onVote}
            className="mt-auto self-start py-1 text-xs text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Voter quand même
          </button>
        </>
      )}
    </div>
  );
}

function VotesTab() {
  const servers = useVoteStore((s) => s.servers);
  const currentId = useVoteStore((s) => s.currentId);
  const setCurrent = useVoteStore((s) => s.setCurrent);
  const showTime = useVoteStore((s) => s.settings.showTime ?? false);
  const now = useNow();
  const host = useHost();
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

  if ((!server || adding) && !host.addServers) {
    return <ExtensionNeeded onCancel={server ? () => setAdding(false) : undefined} />;
  }
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

  const voteLabel = ready.length > 1 ? `Voter les ${ready.length} à la suite` : 'Voter maintenant';
  const startAll = () => setQueue(ready.map((s) => s.id));

  return (
    <div className="flex flex-col gap-4">
      {/* Sélecteur segmenté : passe à la ligne quand il y a beaucoup de serveurs. */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-alt p-1">
        {servers.map((s) => {
          const count = s.sites.filter((site) => isAvailable(site, now)).length;
          const active = s.id === server.id;
          return (
            <button
              key={s.id}
              type="button"
              disabled={queue !== null}
              aria-pressed={active}
              onClick={() => setCurrent(s.id)}
              className={`min-h-10 flex-1 basis-24 rounded-lg px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
                active ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
              }`}
            >
              {s.name} <span className={`font-mono ${active ? 'text-accent' : ''}`}>{count}</span>
            </button>
          );
        })}
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
                {nextSite?.nextAt
                  ? `Prochain dans ${formatLeft(nextSite.nextAt - now)}${showTime ? ` (${formatClock(nextSite.nextAt, now)})` : ''} · ${nextSite.host}`
                  : 'Tous les sites sont disponibles.'}
              </p>
            </div>
            {/* Écran large : le bouton est ici. Écran étroit : il reste collé en bas (voir plus bas). */}
            <div className="hidden sm:block">
              <Button disabled={ready.length === 0} onClick={startAll}>
                {voteLabel}
              </Button>
            </div>
          </Card>

          {server.error && <p className="text-xs text-red-500">{describeVoteError(server.error)}</p>}

          {/* Une tuile par site de vote : deux colonnes dans le panneau latéral et sur téléphone. */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {sorted.map((site) => (
              <SiteTile key={site.id} serverId={server.id} site={site} now={now} showTime={showTime} onVote={() => setQueue([site.id])} />
            ))}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-28 items-center justify-center gap-1 rounded-xl border border-dashed border-text-muted p-3 text-sm font-semibold text-accent"
            >
              <Plus size={16} /> Ajouter un serveur
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="font-mono text-text">{server.pseudo}</span>
              <CopyPseudoButton pseudo={server.pseudo} />
              {server.monthVotes !== null && <span>· {server.monthVotes} vote{server.monthVotes > 1 ? 's' : ''} ce mois</span>}
              {server.lastCheckedAt && <span>· vérifié {relativeTime(server.lastCheckedAt, now)}</span>}
            </span>
            <span className="flex items-center gap-4">
              {host.refresh && (
                <button type="button" onClick={refresh} disabled={refreshing} className="flex items-center gap-1 hover:text-text">
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Actualiser
                </button>
              )}
              <RemoveServerButton server={server} />
            </span>
          </div>

          {/* Écran étroit : le bouton principal reste sous le pouce, collé en bas. */}
          {ready.length > 0 && (
            <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-surface px-3 py-3 sm:hidden">
              <Button onClick={startAll} className="w-full py-3 text-base">
                {voteLabel}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Envoie une notification d'essai dans 30 secondes, pour vérifier que les rappels arrivent bien. */
function TestNotification() {
  const now = useNow();
  const [due, setDue] = useState<number | null>(null);
  const left = due === null ? 0 : Math.ceil((due - now) / 1000);

  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <Button variant="secondary" disabled={due !== null && left > 0} onClick={async () => setDue(await scheduleTestNotification())}>
          <BellRing size={14} /> {due !== null && left > 0 ? `Notification dans ${left} s` : 'Tester une notification dans 30 s'}
        </Button>
      </div>
      {due !== null && (
        <p className="text-xs text-text-muted">
          {left > 0
            ? 'Tu peux fermer cet écran : elle arrivera quand même, avec le son choisi.'
            : "Notification envoyée à Windows. Rien vu ? Active « Garder la notification à l'écran » ci-dessus : Windows l'affiche alors même pendant une vidéo ou un jeu en plein écran. Sinon, il la range sans bruit dans le centre de notifications (l'horloge en bas à droite)."}
        </p>
      )}
    </div>
  );
}

function SettingsTab() {
  const settings = useVoteStore((s) => s.settings);
  const update = useVoteStore((s) => s.updateSettings);
  const host = useHost();
  const modes: { id: OpenMode; label: string }[] = [
    { id: 'tab', label: 'Nouvel onglet' },
    { id: 'window', label: 'Petite fenêtre' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          <AccountSection />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex min-w-0 flex-col gap-2">
            <h2 className={groupTitleClass}>Réglages des rappels</h2>
            <Card className="flex min-w-0 flex-col divide-y divide-border py-1">
              <div className={rowClass}>
                <Switch reverse checked={settings.notify} onChange={(notify) => update({ notify })} label="Prévenir dès qu'un vote est disponible" />
              </div>
              <label className={`${rowClass} text-sm text-text`}>
                Relancer si je n'ai pas voté
                <select value={settings.remindMinutes} onChange={(e) => update({ remindMinutes: Number(e.target.value) })} className={selectClass}>
                  <option value={0}>Jamais</option>
                  <option value={5}>Toutes les 5 min</option>
                  <option value={10}>Toutes les 10 min</option>
                  <option value={30}>Toutes les 30 min</option>
                  <option value={60}>Toutes les heures</option>
                </select>
              </label>
              <div className={rowClass}>
                <Switch reverse checked={settings.quietNight} onChange={(quietNight) => update({ quietNight })} label="Ne pas déranger" />
                <span className="flex items-center gap-1.5 text-sm text-text-muted">
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
              <div className={rowClass}>
                <Switch reverse checked={settings.sound} onChange={(sound) => update({ sound })} label="Jouer un son" />
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
              <label className={`${rowClass} text-sm text-text`}>
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
              {host.extension === 'self' && (
                <div className="py-3">
                  <TestNotification />
                </div>
              )}
            </Card>
            <p className="px-1 text-xs text-text-muted">
              {host.extension === 'self'
                ? 'Les rappels arrivent tant que le navigateur est ouvert, même sans cet écran.'
                : "Les rappels sont envoyés par l'extension Limeris votes, dans les navigateurs où elle est connectée à ton compte."}
            </p>
          </section>

          <section className="flex min-w-0 flex-col gap-2">
            <h2 className={groupTitleClass}>Pendant le vote</h2>
            <Card className="flex min-w-0 flex-col divide-y divide-border py-1">
              <div className={`${rowClass} text-sm text-text`}>
                Ouvrir les sites de vote dans
                <div className="flex gap-1 rounded-lg bg-surface-alt p-1">
                  {modes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={settings.openMode === m.id}
                      onClick={() => update({ openMode: m.id })}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        settings.openMode === m.id ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={rowClass}>
                <Switch reverse checked={settings.chain} onChange={(chain) => update({ chain })} label="Passer seul au site suivant" />
              </div>
              <div className="py-3">
                <p className="text-xs text-text">Conseil : l'extension Buster aide à passer les captchas plus vite.</p>
                <button type="button" onClick={() => openExternal(BUSTER_URL)} className="mt-1.5 text-left text-xs font-medium text-accent">
                  Voir Buster sur le Chrome Web Store
                </button>
              </div>
            </Card>
            <p className="px-1 text-xs text-text-muted">
              Limeris ne vote pas à ta place : tu valides le captcha sur chaque site, et le site du serveur confirme
              ensuite le vote et donne la récompense.
            </p>
          </section>

          <section className="flex min-w-0 flex-col gap-2">
            <h2 className={groupTitleClass}>Affichage</h2>
            <Card className="flex min-w-0 flex-col divide-y divide-border py-1">
              <div className={rowClass}>
                <Switch reverse checked={settings.showTime ?? false} onChange={(showTime) => update({ showTime })} label="Afficher l'heure de chaque vote" />
              </div>
            </Card>
            <p className="px-1 text-xs text-text-muted">
              En plus du compte à rebours, par exemple « à 15 h 12 ». Ce réglage reste sur cet appareil.
            </p>
          </section>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3 border-t border-border pt-4">
        <a href={SITE_URL} target="_blank" rel="noreferrer" title="Ouvrir limeris.fr" className="shrink-0">
          <img src={assetUrl('icons/128.png')} alt="Limeris" width={40} height={40} className="h-10 w-10 rounded-xl" />
        </a>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">
            Limeris votes <span className="font-mono text-xs font-normal text-text-muted">v{appVersion()}</span>
          </p>
          <p className="text-xs text-text-muted">
            Développé par <span className="font-medium text-text">Sliver91</span> · <SiteLink />
          </p>
          <p className="text-xs text-text-muted">© 2026 Sliver91. Tous droits réservés.</p>
        </div>
      </div>
    </div>
  );
}

export function VotesPage() {
  const [tab, setTab] = useState<Tab>('votes');
  const host = useHost();

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
          {host.closable && (
          <button
            type="button"
            onClick={() => window.close()}
            aria-label="Fermer"
            title="Fermer"
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
          >
            <X size={14} /> Fermer
          </button>
          )}
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
