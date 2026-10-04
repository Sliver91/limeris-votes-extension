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
}

export interface VoteServer {
  id: string;
  name: string;
  baseUrl: string;
  pseudo: string;
  sites: VoteSite[];
  /** Votes du mois en cours, comptés par le site du serveur. */
  monthVotes: number | null;
  lastCheckedAt: number | null;
  /** Dernier code d'erreur renvoyé par le site, ou null si tout va bien. */
  error: string | null;
}

export type OpenMode = 'tab' | 'window';

/** Sons de rappel livrés avec l'extension (public/sounds). */
export const VOTE_SOUNDS = ['votes-commencent', 'whatsapp-web', 'fears-to-fathom', 'follow', 'western-whistle'] as const;
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
};

/** Ce qui est enregistré dans le navigateur sous STATE_KEY. */
export interface VoteData {
  servers: VoteServer[];
  currentId: string | null;
  settings: VoteSettings;
}

/** 'v' = vote confirmé par le site du serveur, 'o' = un site est redevenu disponible. */
export type VoteEventKind = 'v' | 'o';

export interface VoteEvent {
  t: number;
  serverId: string;
  host: string;
  kind: VoteEventKind;
  /** Message de récompense renvoyé par le site (votes seulement). */
  reward?: string;
  /** Vote validé à la main, sans confirmation du site du serveur. */
  manual?: boolean;
}

export const MAX_EVENTS = 8000;

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
        // Un délai en cours remet le signalement à zéro : le moteur préviendra à son échéance.
        return next !== null
          ? { ...site, nextAt: next, notified: false, lastRemindAt: null }
          : { ...site, nextAt: null, localUntil: null };
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
  }));
}

export function setServerError(servers: VoteServer[], id: string, error: string | null): VoteServer[] {
  return servers.map((server) => (server.id === id ? { ...server, error } : server));
}
