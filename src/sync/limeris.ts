/**
 * Lien entre l'extension et le compte limeris.fr.
 *
 * L'extension n'a pas de formulaire de connexion : « Se connecter » ouvre limeris.fr, où
 * l'utilisateur est connecté avec le login du site. La page « Autoriser » remet alors un jeton
 * à l'extension par un message (voir service-worker.ts). Ce jeton, réservé aux votes, sert
 * ensuite à synchroniser.
 */

import { readData, readHistory, writeData, writeHistory } from '../store/chromeStorage';
import { applyRemote, buildPush, EVENTS_PER_PUSH, mergeEvents, type WireState } from './wire';

/** Domaine fixe, jamais configurable : le jeton ne doit partir nulle part ailleurs. */
export const LIMERIS_URL = 'https://limeris.fr';
export const VOTES_URL = `${LIMERIS_URL}/votes`;
/** Page du site qui crée le jeton et l'envoie à l'extension. */
export const CONNECT_URL = `${LIMERIS_URL}/votes/connexion-extension`;

const LIMERIS_ORIGINS = ['https://limeris.fr', 'https://www.limeris.fr'];

/** Messages que la page de limeris.fr peut envoyer à l'extension. */
export const MSG_PING = 'limeris-votes:ping';
export const MSG_CONNECT = 'limeris-votes:connect';
/** Affiche l'outil (panneau ou onglet de l'extension). */
export const MSG_OPEN = 'limeris-votes:open';
/** Relit les délais d'un serveur déjà suivi par l'extension, depuis ce navigateur. */
export const MSG_CHECK = 'limeris-votes:check';
/** Demande au site d'un serveur déjà suivi si un vote est validé, depuis ce navigateur. */
export const MSG_CONFIRM = 'limeris-votes:confirm';

export interface LimerisAccount {
  /** Jeton réservé aux votes, remis par limeris.fr. Jamais affiché ni envoyé ailleurs. */
  token: string;
  pseudo: string;
  /** Identifiant du compte sur limeris.fr : la page sait ainsi si l'extension est reliée au même compte qu'elle. */
  accountId?: string;
  connectedAt: number;
  lastSyncAt: number | null;
}

/** Pourquoi l'extension n'est plus connectée, quand ce n'est pas l'utilisateur qui l'a demandé. */
export type AccountNotice = 'revoked';

/** Vrai si le texte a la forme d'un jeton : c'est limeris.fr qui dit ensuite s'il est valable. */
export function isTokenShaped(token: string): boolean {
  return token.length >= 20 && token.length <= 512 && !/\s/.test(token);
}

/** Vrai si le message vient bien d'une page de limeris.fr, et de nulle part ailleurs. */
export function isLimerisSender(sender: { origin?: string; url?: string }): boolean {
  let origin = sender.origin;
  if (!origin && sender.url) {
    try {
      origin = new URL(sender.url).origin;
    } catch {
      return false;
    }
  }
  return origin !== undefined && LIMERIS_ORIGINS.includes(origin);
}

/** Lit un message de connexion ; `null` s'il n'a pas la forme attendue. */
export function parseConnectMessage(message: unknown, now: number): LimerisAccount | null {
  if (typeof message !== 'object' || message === null) return null;
  const { type, token, pseudo, accountId } = message as Record<string, unknown>;
  if (type !== MSG_CONNECT || typeof token !== 'string' || !isTokenShaped(token)) return null;
  return {
    token,
    pseudo: typeof pseudo === 'string' ? pseudo.slice(0, 64) : '',
    ...(typeof accountId === 'string' && accountId.length > 0 && accountId.length <= 64 ? { accountId } : {}),
    connectedAt: now,
    lastSyncAt: null,
  };
}

export const SYNC_ERR = {
  /** L'API de synchronisation de limeris.fr ne répond pas à cette adresse. */
  UNAVAILABLE: 'SYNC_UNAVAILABLE',
  /** Jeton refusé : expiré, révoqué depuis le compte, ou compte suspendu. */
  TOKEN: 'SYNC_TOKEN',
  /** Trop d'appels en peu de temps. */
  BUSY: 'SYNC_BUSY',
  /** limeris.fr a refusé les données envoyées ; son message suit le code. */
  REFUSED: 'SYNC_REFUSED',
  /** Pas de réseau, ou accès à limeris.fr non autorisé dans le navigateur. */
  NETWORK: 'SYNC_NETWORK',
} as const;

export function describeSyncError(error: unknown): string {
  const code = String(error);
  if (code.includes(SYNC_ERR.UNAVAILABLE)) return "La synchronisation n'est pas disponible sur limeris.fr pour le moment.";
  if (code.includes(SYNC_ERR.TOKEN)) return "limeris.fr ne reconnaît plus cette extension. Déconnecte-la puis reconnecte-la à ton compte.";
  if (code.includes(SYNC_ERR.BUSY)) return 'Trop de synchronisations à la suite. Réessaie dans une minute.';
  if (code.includes(SYNC_ERR.NETWORK)) return "limeris.fr est injoignable. Vérifie ta connexion et l'accès de l'extension à limeris.fr.";
  if (code.includes(SYNC_ERR.REFUSED)) {
    const detail = code.split(`${SYNC_ERR.REFUSED}:`)[1]?.trim();
    return detail ? `limeris.fr a refusé la synchronisation : ${detail}` : 'limeris.fr a refusé la synchronisation.';
  }
  return 'La synchronisation a échoué. Réessaie dans un instant.';
}

const API_URL = `${LIMERIS_URL}/api/votes/v1`;

/** Où en est cet appareil dans ses échanges avec le compte. Rangé à part, propre à l'appareil. */
export const SYNC_KEY = 'limeris-votes-sync';

interface SyncProgress {
  /** Connexion à laquelle ces repères se rapportent : une reconnexion repart de zéro. */
  connectedAt: number;
  /** Curseur d'historique renvoyé par limeris.fr. */
  cursor: number;
  /** Les événements créés avant cette date ont déjà été envoyés. */
  sentUntil: number;
}

async function readProgress(account: LimerisAccount): Promise<SyncProgress> {
  const got = await chrome.storage.local.get(SYNC_KEY);
  const saved = got[SYNC_KEY] as SyncProgress | undefined;
  if (saved && saved.connectedAt === account.connectedAt) return saved;
  return { connectedAt: account.connectedAt, cursor: 0, sentUntil: 0 };
}

async function call(account: LimerisAccount, path: string, init?: { method: 'POST' | 'DELETE'; body?: unknown }): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${account.token}`,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      // Le jeton suffit : les cookies de limeris.fr ne partent pas avec lui.
      credentials: 'omit',
    });
  } catch {
    throw new Error(SYNC_ERR.NETWORK);
  }
  if (response.status === 401 || response.status === 403) throw new Error(SYNC_ERR.TOKEN);
  if (response.status === 404) throw new Error(SYNC_ERR.UNAVAILABLE);
  if (response.status === 429) throw new Error(SYNC_ERR.BUSY);
  const json = (await response.json().catch(() => null)) as { erreur?: unknown } | null;
  if (!response.ok || json === null) {
    if (response.status >= 500 || json === null) throw new Error(SYNC_ERR.UNAVAILABLE);
    throw new Error(`${SYNC_ERR.REFUSED}: ${typeof json.erreur === 'string' ? json.erreur : ''}`);
  }
  return json;
}

/** Applique l'état renvoyé par le compte aux données et à l'historique enregistrés. */
async function applyState(remote: WireState): Promise<void> {
  // Relecture juste avant d'écrire : un écran ou le service worker a pu modifier les données
  // pendant l'appel réseau.
  await writeData(applyRemote(await readData(), remote, Date.now()));
  const events = await readHistory();
  const merged = mergeEvents(events, remote.evenements);
  if (merged !== events) await writeHistory(merged);
}

/**
 * Envoie les changements de cet appareil à limeris.fr (`POST /api/votes/v1/synchro`) et applique
 * l'état du compte reçu en retour. Renvoyer deux fois la même chose ne change rien côté compte :
 * une synchronisation interrompue se rejoue sans risque.
 */
export async function syncNow(account: LimerisAccount): Promise<void> {
  const progress = await readProgress(account);
  const startedAt = Date.now();
  let cursor = progress.cursor;

  const pending = (await readHistory()).filter((event) => event.t >= progress.sentUntil);
  let sent = 0;
  let remote: WireState;
  do {
    const batch = pending.slice(sent, sent + EVENTS_PER_PUSH);
    remote = (await call(account, '/synchro', { method: 'POST', body: buildPush(await readData(), batch, cursor) })) as WireState;
    await applyState(remote);
    cursor = remote.curseur;
    sent += batch.length;
  } while (sent < pending.length);

  // Historique du compte plus long qu'une réponse : on lit la suite.
  while (remote.suite) {
    remote = (await call(account, `/etat?depuis=${cursor}`)) as WireState;
    await applyState(remote);
    cursor = remote.curseur;
  }

  await chrome.storage.local.set({ [SYNC_KEY]: { connectedAt: account.connectedAt, cursor, sentUntil: startedAt } satisfies SyncProgress });
}

/**
 * Révoque le jeton de cette extension sur limeris.fr (`DELETE /api/votes/v1/jetons/courant`), à la
 * déconnexion. Sans réseau, la déconnexion se fait quand même : le jeton reste révocable depuis le
 * compte, et expire seul s'il ne sert plus.
 */
export async function revokeToken(account: LimerisAccount): Promise<void> {
  await call(account, '/jetons/courant', { method: 'DELETE' }).catch(() => {});
  await chrome.storage.local.remove(SYNC_KEY);
}
