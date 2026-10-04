/**
 * Lien entre l'extension et le compte limeris.fr.
 *
 * L'extension n'a pas de formulaire de connexion : « Se connecter » ouvre limeris.fr, où
 * l'utilisateur est connecté avec le login du site. La page « Autoriser » remet alors un jeton
 * à l'extension par un message (voir service-worker.ts). Ce jeton, réservé aux votes, sert
 * ensuite à synchroniser.
 */

/** Domaine fixe, jamais configurable : le jeton ne doit partir nulle part ailleurs. */
export const LIMERIS_URL = 'https://limeris.fr';
export const VOTES_URL = `${LIMERIS_URL}/votes`;
/** Page du site qui crée le jeton et l'envoie à l'extension. */
export const CONNECT_URL = `${LIMERIS_URL}/votes/connexion-extension`;

const LIMERIS_ORIGINS = ['https://limeris.fr', 'https://www.limeris.fr'];

/** Messages que la page de limeris.fr peut envoyer à l'extension. */
export const MSG_PING = 'limeris-votes:ping';
export const MSG_CONNECT = 'limeris-votes:connect';

export interface LimerisAccount {
  /** Jeton réservé aux votes, remis par limeris.fr. Jamais affiché ni envoyé ailleurs. */
  token: string;
  pseudo: string;
  connectedAt: number;
  lastSyncAt: number | null;
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
  const { type, token, pseudo } = message as Record<string, unknown>;
  if (type !== MSG_CONNECT || typeof token !== 'string') return null;
  if (token.length < 20 || token.length > 512 || /\s/.test(token)) return null;
  return {
    token,
    pseudo: typeof pseudo === 'string' ? pseudo.slice(0, 64) : '',
    connectedAt: now,
    lastSyncAt: null,
  };
}

export const SYNC_ERR = {
  /** L'API de synchronisation de limeris.fr n'est pas encore en ligne. */
  UNAVAILABLE: 'SYNC_UNAVAILABLE',
} as const;

export function describeSyncError(error: unknown): string {
  const code = String(error);
  if (code.includes(SYNC_ERR.UNAVAILABLE)) return "La synchronisation n'est pas encore ouverte sur limeris.fr. Elle s'activera avec la page limeris.fr/votes.";
  return 'La synchronisation a échoué. Réessaie dans un instant.';
}

/**
 * Envoie les changements de cet appareil à limeris.fr et récupère ceux du compte.
 *
 * À brancher sur `/api/votes/v1/` dès que son format est fixé côté site : d'ici là, aucun appel
 * n'est fait, pour ne jamais afficher « synchronisé » alors que rien ne l'a été.
 */
export async function syncNow(_account: LimerisAccount): Promise<void> {
  throw new Error(SYNC_ERR.UNAVAILABLE);
}
