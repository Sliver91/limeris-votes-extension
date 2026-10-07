import { checkUser, fetchSites } from '../azuriom/client';
import { hostOf, normalizeBase, parseVoteLinks } from '../azuriom/parse';
import { isDirect, shortHash, useVoteStore, type VoteServer } from '../store/store';

export { describeVoteError } from '../azuriom/errors';

/** Lit la page de vote d'un site Azuriom et prépare le serveur à enregistrer. */
export async function importServer(address: string, pseudo: string): Promise<VoteServer> {
  const info = await fetchSites(address);
  const status = await checkUser(info.baseUrl, pseudo);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: info.host,
    baseUrl: info.baseUrl,
    pseudo,
    monthVotes: status.votes,
    lastCheckedAt: now,
    error: null,
    sites: info.sites.map((site) => {
      const next = status.sites[site.id] ?? null;
      const waiting = next !== null && next > now;
      return {
        id: site.id,
        url: site.url,
        voteUrl: site.voteUrl,
        host: site.host,
        label: site.label,
        nextAt: waiting ? next : null,
        // Un site déjà disponible à l'ajout est sous les yeux de l'utilisateur : pas de
        // notification pour cet état initial, seulement pour les échéances suivantes.
        notified: !waiting,
        lastRemindAt: now,
      };
    }),
  };
}

/** Prépare un serveur sans site Azuriom à partir de ses liens de vote : un site de vote par lien. */
export function directServer(name: string, links: string, pseudo: string): VoteServer {
  const urls = parseVoteLinks(links);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    baseUrl: normalizeBase(urls[0]),
    pseudo,
    monthVotes: null,
    lastCheckedAt: null,
    error: null,
    sites: urls.map((url) => ({
      id: `d_${shortHash(url)}`,
      url,
      // Pas de route de confirmation : c'est ce qui distingue ces serveurs (voir isDirect).
      voteUrl: url,
      host: hostOf(url),
      label: '',
      nextAt: null,
      notified: true,
      lastRemindAt: now,
    })),
  };
}

/** Redemande au site du serveur l'heure du prochain vote de chaque site. */
export async function refreshServer(serverId: string): Promise<void> {
  const server = useVoteStore.getState().servers.find((s) => s.id === serverId);
  if (!server || isDirect(server)) return;
  try {
    const status = await checkUser(server.baseUrl, server.pseudo);
    useVoteStore.getState().applyStatus(serverId, status.sites, status.votes);
  } catch (e) {
    useVoteStore.getState().setServerError(serverId, String(e));
  }
}

/** Lien du site de vote avec le pseudo déjà en place quand le serveur l'a prévu. */
export function siteLink(url: string, pseudo: string): string {
  return url.replace('{player}', encodeURIComponent(pseudo));
}
