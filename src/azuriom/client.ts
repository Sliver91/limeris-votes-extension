import { ERR } from './errors';
import { csrfToken, hostOf, normalizeBase, parseSites, type VoteSiteInfo } from './parse';

/**
 * Appels au site du serveur (Azuriom), repris de minecraft_votes.rs.
 *
 * Tout part du navigateur de l'utilisateur, donc avec sa connexion : c'est ce que le site du
 * serveur attend, puisqu'il vérifie un vote avec l'adresse IP qui l'appelle. Les cookies de
 * session sont ceux du navigateur (`credentials: 'include'`) ; seul le jeton CSRF est gardé ici.
 */

export interface VoteServerInfo {
  baseUrl: string;
  host: string;
  sites: VoteSiteInfo[];
}

export interface VoteUserStatus {
  /** Pour chaque site : heure (ms) du prochain vote possible, ou `null` s'il est disponible. */
  sites: Record<string, number | null>;
  /** Nombre de votes du mois en cours, compté par le site du serveur. */
  votes: number;
}

export interface VoteConfirm {
  status: 'pending' | 'done' | 'select_server' | 'delay';
  message: string | null;
  servers: Record<string, string> | null;
}

const TIMEOUT_MS = 15_000;

/** Jeton CSRF de la session ouverte sur chaque site, conservé entre deux appels. */
const csrfTokens = new Map<string, string>();

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  } catch (e) {
    console.warn('[limeris-votes] erreur réseau :', e);
    throw new Error(ERR.NETWORK);
  }
}

async function fetchVotePage(base: string): Promise<{ html: string; csrf: string }> {
  const resp = await request(`${base}/vote`);
  if (!resp.ok) throw new Error(`SERVER_ERROR:${resp.status}`);
  let html: string;
  try {
    html = await resp.text();
  } catch {
    throw new Error(ERR.NETWORK);
  }
  return { html, csrf: csrfToken(html) ?? '' };
}

/** Lit la page de vote d'un site Azuriom et renvoie la liste de ses sites de vote. */
export async function fetchSites(address: string): Promise<VoteServerInfo> {
  const base = normalizeBase(address);
  const { html, csrf } = await fetchVotePage(base);
  const sites = parseSites(html, base);
  if (sites.length === 0) throw new Error(ERR.NO_SITES);
  csrfTokens.set(base, csrf);
  return { baseUrl: base, host: hostOf(base), sites };
}

/** Demande au site du serveur, pour un pseudo, quand chaque site de vote redevient disponible. */
export async function checkUser(baseUrl: string, pseudo: string): Promise<VoteUserStatus> {
  const base = normalizeBase(baseUrl);
  const resp = await request(`${base}/vote/user/${encodeURIComponent(pseudo.trim())}`, {
    headers: { Accept: 'application/json' },
  });

  switch (resp.status) {
    case 200:
      break;
    case 401:
      throw new Error(ERR.AUTH_REQUIRED);
    case 404:
    case 422:
      throw new Error(ERR.USER_NOT_FOUND);
    case 429:
      throw new Error(ERR.RATE_LIMITED);
    default:
      throw new Error(`SERVER_ERROR:${resp.status}`);
  }

  let body: { sites?: Record<string, unknown>; votes?: unknown };
  try {
    body = await resp.json();
  } catch {
    throw new Error(ERR.NETWORK);
  }
  const sites: Record<string, number | null> = {};
  for (const [id, value] of Object.entries(body.sites ?? {})) {
    sites[id] = typeof value === 'number' ? Math.trunc(value) : null;
  }
  return { sites, votes: typeof body.votes === 'number' ? body.votes : 0 };
}

/**
 * Demande au site du serveur si le vote est validé — le même appel que fait sa propre page de
 * vote après un clic. Tant que le site de vote n'a pas confirmé, la réponse est "pending".
 */
export async function confirmVote(
  baseUrl: string,
  voteUrl: string,
  pseudo: string,
  gameServer?: string
): Promise<VoteConfirm> {
  const base = normalizeBase(baseUrl);
  if (!voteUrl.startsWith(`${base}/`)) throw new Error(ERR.BAD_URL);

  for (let attempt = 0; attempt < 2; attempt++) {
    let csrf = csrfTokens.get(base);
    if (!csrf) {
      csrf = (await fetchVotePage(base)).csrf;
      csrfTokens.set(base, csrf);
    }

    const payload: Record<string, string> = { user: pseudo.trim() };
    if (gameServer) payload.server = gameServer;

    const resp = await request(`${voteUrl.replace(/\/+$/, '')}/done`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': csrf,
      },
      body: JSON.stringify(payload),
    });

    const body: Record<string, unknown> = await resp.json().catch(() => ({}));
    const message = typeof body?.message === 'string' ? body.message : null;

    switch (resp.status) {
      case 200: {
        const raw = body?.servers;
        const servers =
          raw && typeof raw === 'object'
            ? Object.fromEntries(Object.entries(raw).map(([id, name]) => [id, typeof name === 'string' ? name : id]))
            : null;
        const status = body?.status === 'pending' ? 'pending' : body?.status === 'select_server' ? 'select_server' : 'done';
        return { status, message, servers };
      }
      case 419: {
        // 419 sert à deux choses côté site : session expirée (on en rouvre une et on réessaie
        // une fois) ou vote encore en délai (le message donne le temps restant).
        const expired = message?.toLowerCase().includes('csrf') ?? false;
        if (!expired) return { status: 'delay', message, servers: null };
        csrfTokens.delete(base);
        if (attempt === 0) continue;
        throw new Error(ERR.SESSION_REFUSED);
      }
      case 401:
        throw new Error(ERR.AUTH_REQUIRED);
      case 404:
        throw new Error(ERR.SITE_NOT_FOUND);
      case 429:
        throw new Error(ERR.RATE_LIMITED);
      default:
        throw new Error(`SERVER_ERROR:${resp.status}`);
    }
  }
  throw new Error(ERR.NETWORK);
}
