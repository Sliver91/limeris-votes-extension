import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card } from './components/Card';
import { Button } from './components/Button';
import { confirmVote } from '../azuriom/client';
import { closeSite, openSite as openSiteTab } from '../platform';
import { describeVoteError, refreshServer, siteLink } from './api';
import { formatDelay } from './format';
import { CopyPseudoButton, copyPseudo } from './CopyPseudoButton';
import { useVoteHistoryStore, useVoteStore, type VoteServer, type VoteSite } from '../store/store';

/** Même rythme que la page de vote du site : assez lent pour rester sous sa limite d'appels. */
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;
/** Une confirmation plus rapide que ça vient d'un site que le serveur ne vérifie pas : le vote
 * lui-même n'a pas encore eu le temps d'être fait, on laisse donc le site ouvert. */
const EARLY_CONFIRM_MS = 15_000;
const NEXT_DELAY_MS = 1_800;

/** Délais proposés quand on valide un vote à la main (le site du serveur ne les publie pas). */
const MANUAL_DELAYS_MIN = [90, 120, 180, 720, 1440];
/** Délai présélectionné la première fois, pour les sites de vote les plus courants. */
const USUAL_DELAY_MIN: Record<string, number> = {
  'serveur-minecraft.com': 180,
  'serveur-prive.net': 90,
  'top-serveurs.net': 120,
  'serveursminecraft.org': 1440,
  'serveur-minecraft-vote.fr': 90,
};

const delayPillClass = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
    active ? 'border-accent bg-accent-soft text-text' : 'border-border text-text-muted hover:text-text'
  }`;
const delayInputClass = 'w-14 rounded-lg border border-border bg-surface px-2 py-1 text-sm tabular-nums text-text';

type Phase ='waiting' | 'manual' | 'done' | 'early' | 'delay' | 'select' | 'error';

interface VoteQueueProps {
  server: VoteServer;
  siteIds: string[];
  onClose: () => void;
}

/** Enchaîne les sites de vote un par un : ouvre le site, puis attend que le site du serveur confirme. */
export function VoteQueue({ server, siteIds, onClose }: VoteQueueProps) {
  const settings = useVoteStore((s) => s.settings);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [message, setMessage] = useState<string | null>(null);
  const [gameServers, setGameServers] = useState<Record<string, string> | null>(null);
  const [confirmed, setConfirmed] = useState(0);
  const [manualDelay, setManualDelay] = useState(180);
  /** Délai exact saisi à la main (heures et minutes), à la place d'un des délais proposés. */
  const [custom, setCustom] = useState(false);
  const [customHours, setCustomHours] = useState('');
  const [customMinutes, setCustomMinutes] = useState('');

  const timer = useRef<number>();
  const openedAt = useRef(0);
  /** Change à chaque étape : une réponse arrivée après un changement d'étape est ignorée. */
  const runId = useRef(0);
  const serverRef = useRef(server);
  serverRef.current = server;
  /** Vrai tant que l'utilisateur choisit son délai : les réponses du site ne changent plus l'écran. */
  const choosingDelay = useRef(false);
  /** Le site du serveur a confirmé le vote pendant que l'utilisateur choisissait son délai. */
  const [serverConfirmed, setServerConfirmed] = useState(false);

  const site = server.sites.find((s) => s.id === siteIds[index]);
  const hasNext = index + 1 < siteIds.length;
  const inWindow = settings.openMode === 'window';

  function openSite(target: VoteSite) {
    // Pseudo prêt à coller : tous les sites de vote ne le préremplissent pas. Copié avant
    // d'ouvrir le site, tant que cet écran a encore le focus.
    copyPseudo(serverRef.current.pseudo);
    openSiteTab(siteLink(target.url, serverRef.current.pseudo), useVoteStore.getState().settings.openMode).catch(() => {});
  }

  /** Vote terminé : on enchaîne dans le même onglet s'il reste un site, sinon on le ferme. */
  function finishStep() {
    const chain = useVoteStore.getState().settings.chain;
    if (chain && hasNext) timer.current = window.setTimeout(() => setIndex((i) => i + 1), NEXT_DELAY_MS);
    else closeSite();
  }

  async function poll(target: VoteSite, run: number, gameServer?: string) {
    try {
      const current = serverRef.current;
      const res = await confirmVote(current.baseUrl, target.voteUrl, current.pseudo, gameServer);
      if (run !== runId.current) return;

      // Pendant le choix du délai, une réponse du site ne doit pas refermer ce choix sous les
      // doigts de l'utilisateur : on continue d'écouter (c'est cet appel qui donne la récompense)
      // mais l'écran reste sur le choix.
      const choosing = choosingDelay.current;

      if (res.status === 'pending') {
        if (!choosing && Date.now() - openedAt.current > POLL_TIMEOUT_MS) {
          setPhase('error');
          setMessage("Le vote n'a pas été confirmé au bout de 6 minutes. Réessaie ou passe au site suivant.");
          return;
        }
        timer.current = window.setTimeout(() => poll(target, run), POLL_INTERVAL_MS);
        return;
      }
      if (res.status === 'select_server') {
        choosingDelay.current = false;
        setGameServers(res.servers ?? {});
        setPhase('select');
        return;
      }
      if (res.status === 'delay') {
        if (choosing) return;
        setMessage(res.message);
        setPhase('delay');
        refreshServer(current.id);
        return;
      }

      useVoteHistoryStore.getState().push({
        t: Date.now(),
        serverId: current.id,
        host: target.host,
        kind: 'v',
        reward: res.message ?? undefined,
      });
      setConfirmed((c) => c + 1);
      setMessage(res.message);
      refreshServer(current.id);

      if (choosing) {
        setServerConfirmed(true);
        return;
      }
      if (Date.now() - openedAt.current < EARLY_CONFIRM_MS) {
        setPhase('early');
        return;
      }
      setPhase('done');
      finishStep();
    } catch (e) {
      if (run !== runId.current || choosingDelay.current) return;
      setMessage(describeVoteError(e));
      setPhase('error');
    }
  }

  useEffect(() => {
    if (!site) return;
    const run = ++runId.current;
    choosingDelay.current = false;
    setServerConfirmed(false);
    setPhase('waiting');
    setMessage(null);
    setGameServers(null);
    openedAt.current = Date.now();
    openSite(site);
    timer.current = window.setTimeout(() => poll(site, run), POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(timer.current);
      runId.current += 1;
    };
    // Une étape ne redémarre que lorsqu'on change de site, pas à chaque rafraîchissement du store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // File terminée ou arrêtée : le site de vote resté ouvert est refermé.
  useEffect(() => {
    if (!site) closeSite();
  }, [site]);
  useEffect(() => () => void closeSite(), []);

  /** Ouvre le choix du délai : c'est l'utilisateur qui valide, le site du serveur n'ayant pas confirmé. */
  function askManualDelay() {
    if (!site) return;
    // Le dernier délai choisi pour ce site est repris, y compris s'il avait été saisi à la main.
    const initial = site.manualDelayMin ?? USUAL_DELAY_MIN[site.host] ?? 180;
    setManualDelay(initial);
    setCustom(!MANUAL_DELAYS_MIN.includes(initial));
    setCustomHours(String(Math.floor(initial / 60)));
    setCustomMinutes(String(initial % 60));
    choosingDelay.current = true;
    setPhase('manual');
  }

  function pickPreset(min: number) {
    setCustom(false);
    setManualDelay(min);
  }

  function openCustom() {
    setCustom(true);
    setCustomHours(String(Math.floor(manualDelay / 60)));
    setCustomMinutes(String(manualDelay % 60));
  }

  function changeCustom(hours: string, minutes: string) {
    setCustomHours(hours);
    setCustomMinutes(minutes);
    const total = Math.floor(Number(hours) || 0) * 60 + Math.floor(Number(minutes) || 0);
    setManualDelay(Math.max(0, total));
  }

  function validateManually() {
    if (!site) return;
    window.clearTimeout(timer.current);
    runId.current += 1;
    choosingDelay.current = false;
    useVoteStore.getState().validateManually(server.id, site.id, manualDelay);
    // Si le site du serveur a confirmé entre-temps, le vote est déjà compté : seul le délai change.
    if (!serverConfirmed) {
      useVoteHistoryStore.getState().push({ t: Date.now(), serverId: server.id, host: site.host, kind: 'v', manual: true });
      setConfirmed((c) => c + 1);
    }
    setMessage(`${serverConfirmed ? 'Vote confirmé par le site du serveur.' : 'Vote validé par toi.'} Prochain rappel dans ${formatDelay(manualDelay)}.`);
    setPhase('done');
    finishStep();
  }

  function next() {
    window.clearTimeout(timer.current);
    setIndex((i) => i + 1);
  }

  function retry() {
    if (!site) return;
    const run = ++runId.current;
    choosingDelay.current = false;
    setPhase('waiting');
    setMessage(null);
    openedAt.current = Date.now();
    poll(site, run);
  }

  function chooseGameServer(id: string) {
    if (!site) return;
    setPhase('waiting');
    poll(site, runId.current, id);
  }

  if (!site) {
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text">
          {confirmed} vote{confirmed > 1 ? 's' : ''} confirmé{confirmed > 1 ? 's' : ''}
        </h2>
        <p className="text-sm text-text-muted">Limeris te prévient dès qu'un site redevient disponible.</p>
        <div>
          <Button onClick={onClose}>Fermer</Button>
        </div>
      </Card>
    );
  }

  const finished = phase === 'done' || phase === 'early' || phase === 'delay';
  const status =
    phase === 'waiting'
      ? 'En attente de la confirmation du site du serveur…'
      : phase === 'done'
        ? (message ?? 'Vote confirmé.')
        : phase === 'early'
          ? `${message ?? 'Vote confirmé.'} Termine ton vote sur le site, puis passe au suivant.`
          : phase === 'delay'
            ? (message ?? "Ce site n'est pas encore disponible.")
            : phase === 'select'
              ? 'Choisis le serveur de jeu qui reçoit la récompense.'
              : phase === 'manual'
                ? `${serverConfirmed ? 'Le site du serveur a confirmé le vote. ' : ''}Dans combien de temps ce site redevient-il disponible ?`
                : message;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-text-muted">
          Site {index + 1} sur {siteIds.length}
        </span>
        <button type="button" onClick={onClose} className="text-xs text-text-muted hover:text-text">
          Arrêter
        </button>
      </div>

      <div>
        <h2 className="break-words text-lg font-semibold text-text">{site.host}</h2>
        <p className="text-xs text-text-muted">
          Pseudo : <span className="font-mono text-text">{server.pseudo}</span>{' '}
          <CopyPseudoButton pseudo={server.pseudo} /> · déjà copié, il suffit de le coller · le captcha reste à valider par toi
          {inWindow ? ', dans la fenêtre qui vient de s’ouvrir.' : ', dans l’onglet qui vient de s’ouvrir.'}
        </p>
      </div>

      <div className="flex items-start gap-2 text-sm text-text">
        {phase === 'waiting' ? (
          <RefreshCw size={14} className="mt-0.5 shrink-0 animate-spin text-text-muted" />
        ) : (
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              phase === 'error'
                ? 'bg-red-500'
                : phase === 'delay' || phase === 'select' || phase === 'manual'
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
            }`}
          />
        )}
        <span>{status}</span>
      </div>

      {phase === 'select' && gameServers && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(gameServers).map(([id, name]) => (
            <Button key={id} variant="secondary" onClick={() => chooseGameServer(id)}>
              {name}
            </Button>
          ))}
        </div>
      )}

      {phase === 'manual' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {MANUAL_DELAYS_MIN.map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => pickPreset(min)}
                aria-pressed={!custom && manualDelay === min}
                className={delayPillClass(!custom && manualDelay === min)}
              >
                {formatDelay(min)}
              </button>
            ))}
            <button type="button" onClick={openCustom} aria-pressed={custom} className={delayPillClass(custom)}>
              Autre
            </button>
          </div>
          {custom && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
              <input
                type="number"
                min={0}
                max={72}
                inputMode="numeric"
                aria-label="Heures"
                value={customHours}
                onChange={(e) => changeCustom(e.target.value, customMinutes)}
                className={delayInputClass}
              />
              h
              <input
                type="number"
                min={0}
                max={59}
                inputMode="numeric"
                aria-label="Minutes"
                value={customMinutes}
                onChange={(e) => changeCustom(customHours, e.target.value)}
                className={delayInputClass}
              />
              min
            </div>
          )}
          <div>
            <Button onClick={validateManually} disabled={manualDelay < 1}>
              Valider{manualDelay >= 1 ? ` · ${formatDelay(manualDelay)}` : ''}
            </Button>
          </div>
        </div>
      )}

      {phase === 'waiting' && (
        <p className="text-xs text-text-muted">
          Certains sites de vote ne confirment jamais auprès du serveur. Si tu as bien voté, valide toi-même :
          Limeris lance le délai et te préviendra au prochain vote.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(phase === 'waiting' || phase === 'error' || phase === 'delay') && (
          <Button variant={phase === 'waiting' ? 'primary' : 'secondary'} onClick={askManualDelay}>
            J'ai voté
          </Button>
        )}
        {phase === 'error' && <Button onClick={retry}>Réessayer</Button>}
        {finished && <Button onClick={next}>{hasNext ? 'Site suivant' : 'Terminer'}</Button>}
        <Button variant="secondary" onClick={() => openSite(site)}>
          Rouvrir le site
        </Button>
        {!finished && (
          <Button variant="ghost" onClick={next}>
            Passer
          </Button>
        )}
      </div>
    </Card>
  );
}
