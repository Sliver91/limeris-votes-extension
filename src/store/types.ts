/**
 * Données de l'outil et fonctions qui les transforment, sans dépendance au navigateur ni à React :
 * ce fichier sert à la fois aux écrans (store.ts) et au service worker (background/).
 */

export interface VoteSite {
  id: string;
  /** Lien du site de vote, tel que publié par le serveur (peut contenir `{player}`). */
  url: string;
  /** Route du site du serveur pour ce site de vote — sert à confirmer le vote. */
  voteUrl: string;
  host: string;
  label: string;
  /** Heure (ms) du prochain vote possible ; null = disponible maintenant. */
  nextAt: number | null;
  /** Vrai une fois la disponibilité en cours signalée (notification + historique). */
  notified: boolean;
  lastRemindAt: number | null;
  /** Fin du délai lancé à la main, quand le site du serveur n'a pas confirmé le vote. */
  localUntil?: number | null;
  /** Délai entre deux votes choisi à la main pour ce site, en minutes. */
  manualDelayMin?: number | null;
  /**
   * Dernier changement du délai de ce site (ms) : sert à départager deux appareils reliés au même
   * compte Limeris. `notified` et `lastRemindAt` n'y touchent pas, ils restent propres à l'appareil.
   */
  updatedAt?: number;
}

export interface VoteServer {
  id: string;
  name: string;
  baseUrl: string;
  pseudo: string;
  /** Dernier changement du nom, de l'adresse ou du pseudo (ms), pour la synchronisation. */
  identityAt?: number;
  sites: VoteSite[];
  /** Votes du mois en cours, comptés par le site du serveur. */
  monthVotes: number | null;
  lastCheckedAt: number | null;
  /** Dernier code d'erreur renvoyé par le site, ou null si tout va bien. */
  error: string | null;
}

export type OpenMode = 'tab' | 'window';

/** Sons de rappel livrés avec l'extension (public/sounds). */
export const VOTE_SOUNDS = ['votes-commencent', 'follow'] as const;
export type VoteSound = (typeof VOTE_SOUNDS)[number];

export interface VoteSettings {
  notify: boolean;
  /** Relance tant que le vote n'est pas fait, en minutes ; 0 = jamais. */
  remindMinutes: number;
  quietNight: boolean;
  /** Plage de silence, en heures pleines (0–23) ; peut passer minuit (23 → 8). */
  quietFrom: number;
  quietTo: number;
  sound: boolean;
  soundKind: VoteSound;
  /** Volume du son de rappel, de 0 à 1. */
  volume: number;
  openMode: OpenMode;
  chain: boolean;
  /**
   * La notification reste à l'écran jusqu'à ce qu'on la ferme. Windows la traite alors comme un
   * rappel : il l'affiche même pendant une vidéo ou un jeu en plein écran. Propre à l'appareil.
   */
  stayOnScreen: boolean;
  /** Affiche l'heure du prochain vote en plus du compte à rebours. Propre à l'appareil : pas synchronisé. */
  showTime?: boolean;
}

export const DEFAULT_SETTINGS: VoteSettings = {
  notify: true,
  remindMinutes: 10,
  quietNight: false,
  quietFrom: 23,
  quietTo: 8,
  sound: true,
  soundKind: 'votes-commencent',
  volume: 0.6,
  openMode: 'tab',
  chain: true,
  stayOnScreen: true,
  showTime: false,
};

/** Ce qui est enregistré dans le navigateur sous STATE_KEY. */
export interface VoteData {
  servers: VoteServer[];
  currentId: string | null;
  settings: VoteSettings;
  /** Dernier changement des paramètres (ms), pour la synchronisation. */
  settingsAt?: number;
  /** Serveurs retirés sur cet appareil, à annoncer au compte Limeris tant qu'il ne les connaît pas. */
  removed?: string[];
}

/** 'v' = vote confirmé par le site du serveur, 'o' = un site est redevenu disponible. */
export type VoteEventKind = 'v' | 'o';

export interface VoteEvent {
  /** Créé par l'appareil : un événement envoyé deux fois au compte Limeris n'y est compté qu'une fois. */
  id?: string;
  t: number;
  serverId: string;
  host: string;
  siteId?: string;
  kind: VoteEventKind;
  /** Message de récompense renvoyé par le site (votes seulement). */
  reward?: string;
  /** Vote validé à la main, sans confirmation du site du serveur. */
  manual?: boolean;
}

export const MAX_EVENTS = 8000;

/** Empreinte courte et stable d'un texte (FNV-1a, deux passes) : sert d'identifiant d'événement. */
export function shortHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x811c9dc5) + (a >>> 7);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/**
 * Identifiant d'un événement « site redevenu disponible ». Calculé à partir de l'échéance, pas tiré
 * au hasard : deux appareils qui constatent la même disponibilité créent le même identifiant, et
 * le compte Limeris ne la compte qu'une fois.
 */
export function openEventId(serverId: string, siteId: string, deadline: number | null, now: number): string {
  return `o_${shortHash(`${serverId}|${siteId}|${deadline ?? `h${Math.floor(now / 3_600_000)}`}`)}`;
}

/** Donne un identifiant aux événements enregistrés avant la synchronisation, toujours le même. */
export function withEventId(event: VoteEvent): VoteEvent {
  if (event.id) return event;
  return { ...event, id: `l_${shortHash(`${event.t}|${event.serverId}|${event.host}|${event.kind}`)}` };
}

export function isAvailable(site: VoteSite, now: number): boolean {
  return site.nextAt === null || site.nextAt <= now;
}

function mapSite(servers: VoteServer[], serverId: string, siteId: string, fn: (site: VoteSite) => VoteSite): VoteServer[] {
  return servers.map((server) =>
    server.id === serverId ? { ...server, sites: server.sites.map((site) => (site.id === siteId ? fn(site) : site)) } : server
  );
}

/** Applique la réponse du site : heure du prochain vote par site + votes du mois. */
export function applyStatus(
  servers: VoteServer[],
  id: string,
  sites: Record<string, number | null>,
  monthVotes: number,
  now: number
): VoteServer[] {
  return servers.map((server) => {
    if (server.id !== id) return server;
    return {
      ...server,
      monthVotes,
      lastCheckedAt: now,
      error: null,
      sites: server.sites.map((site) => {
        // Le délai choisi à la main fait foi tant qu'il court : c'est le choix de l'utilisateur,
        // et le site du serveur ne connaît pas toujours ce vote. À défaut, celui du site du serveur.
        const remote = sites[site.id] ?? null;
        const local = site.localUntil ?? null;
        const next = local !== null && local > now ? local : remote !== null && remote > now ? remote : null;
        // La date de changement ne bouge que si le délai change vraiment : une relecture qui
        // n'apprend rien ne doit pas passer devant le changement d'un autre appareil.
        const changed = next !== site.nextAt || (next === null && (site.localUntil ?? null) !== null);
        const updatedAt = changed ? now : site.updatedAt;
        // Un délai en cours remet le signalement à zéro : le moteur préviendra à son échéance.
        return next !== null
          ? { ...site, nextAt: next, notified: false, lastRemindAt: null, updatedAt }
          : { ...site, nextAt: null, localUntil: null, updatedAt };
      }),
    };
  });
}

export function patchSite(servers: VoteServer[], serverId: string, siteId: string, patch: Partial<VoteSite>): VoteServer[] {
  return mapSite(servers, serverId, siteId, (site) => ({ ...site, ...patch }));
}

/** Vote validé à la main : lance un délai local que le site du serveur ne connaît pas. */
export function validateManually(servers: VoteServer[], serverId: string, siteId: string, delayMin: number, now: number): VoteServer[] {
  const until = now + delayMin * 60_000;
  return mapSite(servers, serverId, siteId, (site) => ({
    ...site,
    manualDelayMin: delayMin,
    localUntil: until,
    nextAt: until,
    notified: false,
    lastRemindAt: null,
    updatedAt: now,
  }));
}

export function setServerError(servers: VoteServer[], id: string, error: string | null): VoteServer[] {
  return servers.map((server) => (server.id === id ? { ...server, error } : server));
}
