import { normalizeBase } from '../azuriom/parse';
import type { VoteServer, VoteSite } from '../store/types';

/**
 * Ce que la page limeris.fr/votes peut demander à l'extension : relire des délais ou confirmer un
 * vote, depuis ce navigateur, parce que le site du serveur vérifie l'adresse IP du votant.
 *
 * La page ne fournit jamais l'adresse appelée : elle désigne un serveur que l'utilisateur a déjà
 * ajouté dans l'extension, et l'appel part vers l'adresse enregistrée. Même si limeris.fr était un
 * jour détourné, l'extension ne pourrait pas servir à appeler un site choisi par quelqu'un d'autre.
 */

export const BRIDGE_ERR = {
  /** Demande mal formée. */
  BAD_REQUEST: 'BAD_REQUEST',
  /** Ce serveur, ou ce site de vote, n'est pas suivi par l'extension. */
  UNKNOWN_SERVER: 'UNKNOWN_SERVER',
} as const;

/** Serveur suivi par l'extension qui correspond à l'adresse donnée par la page, ou `null`. */
export function findServer(servers: VoteServer[], baseUrl: unknown): VoteServer | null {
  if (typeof baseUrl !== 'string') return null;
  let base: string;
  try {
    base = normalizeBase(baseUrl);
  } catch {
    return null;
  }
  return servers.find((server) => server.baseUrl === base) ?? null;
}

/** Site de vote de ce serveur dont la route de confirmation est celle donnée par la page, ou `null`. */
export function findSite(server: VoteServer, voteUrl: unknown): VoteSite | null {
  if (typeof voteUrl !== 'string') return null;
  return server.sites.find((site) => site.voteUrl === voteUrl) ?? null;
}
