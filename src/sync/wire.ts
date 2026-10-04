import {
  MAX_EVENTS,
  VOTE_SOUNDS,
  withEventId,
  type VoteData,
  type VoteEvent,
  type VoteServer,
  type VoteSettings,
  type VoteSite,
  type VoteSound,
} from '../store/types';

/**
 * Passage entre les données de l'outil et le format de l'API de votes de limeris.fr
 * (`/api/votes/v1`). Sans dépendance au navigateur : sert à l'extension comme à la page /votes.
 */

export interface WireSite {
  id: string;
  url: string;
  urlVote: string;
  hote: string;
  libelle: string;
  prochainLe: number | null;
  localJusqua: number | null;
  delaiManuelMin: number | null;
  modifieLe: number;
}

export interface WireServer {
  id: string;
  nom: string;
  urlBase: string;
  pseudo: string;
  identiteModifieLe: number;
  votesMois: number | null;
  verifieLe: number | null;
  erreur: string | null;
  sites: WireSite[];
}

export interface WireSettings {
  notifier: boolean;
  relanceMinutes: number;
  silenceActif: boolean;
  silenceDe: number;
  silenceA: number;
  son: boolean;
  sonType: string;
  volume: number;
  modeOuverture: 'tab' | 'window';
  enchainer: boolean;
  modifieLe: number;
}

export interface WireEvent {
  id: string;
  date: number;
  serveurId: string;
  siteId: string | null;
  hote: string;
  type: 'v' | 'o';
  manuel: boolean;
  recompense: string | null;
}

/** Réponse de `GET /etat` et de `POST /synchro`. */
export interface WireState {
  revision: number;
  heureServeur: number;
  serveurs: WireServer[];
  suppressions: string[];
  parametres: WireSettings | null;
  evenements: WireEvent[];
  curseur: number;
  suite: boolean;
}

/** Corps de `POST /synchro`. */
export interface WirePush {
  serveurs: WireServer[];
  suppressions: string[];
  parametres?: WireSettings;
  evenements: WireEvent[];
  remplacer?: boolean;
  depuis: number;
}

/** Nombre d'événements par envoi accepté par le serveur. */
export const EVENTS_PER_PUSH = 2000;

function toWireSite(site: VoteSite): WireSite {
  return {
    id: site.id,
    url: site.url,
    urlVote: site.voteUrl,
    hote: site.host.slice(0, 255),
    libelle: site.label.slice(0, 200),
    prochainLe: site.nextAt,
    localJusqua: site.localUntil ?? null,
    delaiManuelMin: site.manualDelayMin ?? null,
    modifieLe: site.updatedAt ?? 0,
  };
}

export function toWireServer(server: VoteServer): WireServer {
  return {
    id: server.id,
    nom: server.name.slice(0, 100),
    urlBase: server.baseUrl,
    pseudo: server.pseudo.slice(0, 64),
    identiteModifieLe: server.identityAt ?? 0,
    votesMois: server.monthVotes,
    verifieLe: server.lastCheckedAt,
    erreur: server.error === null ? null : server.error.slice(0, 200),
    sites: server.sites.map(toWireSite),
  };
}

function toWireSettings(settings: VoteSettings, at: number): WireSettings {
  return {
    notifier: settings.notify,
    relanceMinutes: settings.remindMinutes,
    silenceActif: settings.quietNight,
    silenceDe: settings.quietFrom,
    silenceA: settings.quietTo,
    son: settings.sound,
    sonType: settings.soundKind,
    volume: settings.volume,
    modeOuverture: settings.openMode,
    enchainer: settings.chain,
    modifieLe: at,
  };
}

export function toWireEvent(event: VoteEvent): WireEvent {
  const withId = withEventId(event);
  return {
    id: withId.id as string,
    date: event.t,
    serveurId: event.serverId,
    siteId: event.siteId ?? null,
    hote: event.host.slice(0, 255),
    type: event.kind,
    manuel: event.manual === true,
    recompense: event.reward ? event.reward.slice(0, 500) : null,
  };
}

function fromWireEvent(event: WireEvent): VoteEvent {
  return {
    id: event.id,
    t: event.date,
    serverId: event.serveurId,
    host: event.hote,
    ...(event.siteId ? { siteId: event.siteId } : {}),
    kind: event.type,
    ...(event.recompense ? { reward: event.recompense } : {}),
    ...(event.manuel ? { manual: true } : {}),
  };
}

/** Ce que l'appareil envoie : tout son état (le serveur garde le plus récent) et les événements donnés. */
export function buildPush(data: VoteData, events: VoteEvent[], cursor: number, replace = false): WirePush {
  return {
    serveurs: data.servers.map(toWireServer),
    suppressions: data.removed ?? [],
    // Des paramètres jamais modifiés ne sont pas envoyés : ceux du compte, s'il en a, font foi.
    ...(data.settingsAt !== undefined ? { parametres: toWireSettings(data.settings, data.settingsAt) } : {}),
    evenements: events.slice(0, EVENTS_PER_PUSH).map(toWireEvent),
    ...(replace ? { remplacer: true } : {}),
    depuis: cursor,
  };
}

function applySite(remote: WireSite, local: VoteSite | undefined, now: number): VoteSite {
  const waiting = remote.prochainLe !== null && remote.prochainLe > now;
  // Ce qui a déjà été signalé reste propre à l'appareil. Seul un nouveau délai en cours remet le
  // signalement à zéro, comme dans applyStatus : le moteur préviendra à son échéance.
  let notified = !waiting;
  let lastRemindAt: number | null = now;
  if (local) {
    const sameDeadline = local.nextAt === remote.prochainLe;
    notified = sameDeadline || !waiting ? local.notified : false;
    lastRemindAt = sameDeadline || !waiting ? local.lastRemindAt : null;
  }
  return {
    id: remote.id,
    url: remote.url,
    voteUrl: remote.urlVote,
    host: remote.hote,
    label: remote.libelle,
    nextAt: remote.prochainLe,
    notified,
    lastRemindAt,
    localUntil: remote.localJusqua,
    manualDelayMin: remote.delaiManuelMin,
    updatedAt: remote.modifieLe,
  };
}

function applySettings(remote: WireSettings, local: VoteSettings): VoteSettings {
  const known = (VOTE_SOUNDS as readonly string[]).includes(remote.sonType);
  return {
    notify: remote.notifier,
    remindMinutes: remote.relanceMinutes,
    quietNight: remote.silenceActif,
    quietFrom: remote.silenceDe,
    quietTo: remote.silenceA,
    sound: remote.son,
    soundKind: known ? (remote.sonType as VoteSound) : local.soundKind,
    volume: remote.volume,
    openMode: remote.modeOuverture,
    chain: remote.enchainer,
  };
}

/**
 * Applique l'état renvoyé par le compte Limeris. Il fait foi (le serveur a déjà fusionné ce que
 * l'appareil venait d'envoyer), sauf pour ce qui est propre à l'appareil : serveur affiché,
 * signalements déjà faits.
 */
export function applyRemote(local: VoteData, remote: WireState, now: number): VoteData {
  const servers: VoteServer[] = remote.serveurs.map((server) => {
    const known = local.servers.find((s) => s.id === server.id);
    return {
      id: server.id,
      name: server.nom,
      baseUrl: server.urlBase,
      pseudo: server.pseudo,
      identityAt: server.identiteModifieLe,
      sites: server.sites.map((site) => applySite(site, known?.sites.find((s) => s.id === site.id), now)),
      monthVotes: server.votesMois,
      lastCheckedAt: server.verifieLe,
      error: server.erreur,
    };
  });

  // Un serveur que le compte ne connaît pas encore (ajouté pendant l'échange) est gardé.
  const remoteIds = new Set(servers.map((s) => s.id));
  const deleted = new Set(remote.suppressions);
  for (const server of local.servers) {
    if (!remoteIds.has(server.id) && !deleted.has(server.id)) servers.push(server);
  }

  const currentId = servers.some((s) => s.id === local.currentId) ? local.currentId : (servers[0]?.id ?? null);
  return {
    servers,
    currentId,
    settings: remote.parametres ? applySettings(remote.parametres, local.settings) : local.settings,
    settingsAt: remote.parametres ? remote.parametres.modifieLe : local.settingsAt,
    // Les retraits que le compte connaît n'ont plus à être annoncés.
    removed: (local.removed ?? []).filter((id) => !deleted.has(id)),
  };
}

/** Ajoute les événements reçus du compte à l'historique de l'appareil, sans doublon. */
export function mergeEvents(local: VoteEvent[], remote: WireEvent[]): VoteEvent[] {
  if (remote.length === 0) return local;
  const known = new Set(local.map((e) => withEventId(e).id));
  const added = remote.filter((e) => !known.has(e.id)).map(fromWireEvent);
  if (added.length === 0) return local;
  return [...local, ...added].sort((a, b) => a.t - b.t).slice(-MAX_EVENTS);
}

/** Empreinte de ce qui se synchronise : si elle n'a pas changé, il n'y a rien à envoyer. */
export function syncFingerprint(data: VoteData): string {
  return JSON.stringify(buildPush(data, [], 0));
}
