import { ERR } from './errors';

export interface VoteSiteInfo {
  id: string;
  /** Lien du site de vote, tel que publié par le serveur (peut contenir `{player}`). */
  url: string;
  /** Route Azuriom de ce site (`…/vote/site/{id}`), à laquelle on ajoute `/done` pour confirmer. */
  voteUrl: string;
  host: string;
  label: string;
}

/**
 * Ramène ce que l'utilisateur a collé (`atheramc.fr`, `https://atheramc.fr/vote`…) à l'adresse
 * de base du site, sans le `/vote` final. Seuls http et https sont acceptés.
 */
export function normalizeBase(input: string): string {
  const trimmed = input.trim();
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(ERR.BAD_URL);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    throw new Error(ERR.BAD_URL);
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path.endsWith('/vote') ? path.slice(0, -'/vote'.length) : path}`;
}

/**
 * Liens de vote collés à la main (un par ligne), pour un serveur sans site Azuriom. Seuls http et
 * https sont acceptés ; un lien répété n'est gardé qu'une fois.
 */
export function parseVoteLinks(input: string): string[] {
  const links: string[] = [];
  for (const line of input.split(/\s+/)) {
    if (!line) continue;
    let url: URL;
    try {
      url = new URL(line.includes('://') ? line : `https://${line}`);
    } catch {
      throw new Error(ERR.BAD_URL);
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.')) {
      throw new Error(ERR.BAD_URL);
    }
    if (!links.includes(url.href)) links.push(url.href);
  }
  if (links.length === 0) throw new Error(ERR.BAD_URL);
  return links;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www\.)+/, '');
  } catch {
    return url;
  }
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function attr(tag: string, name: string): string | null {
  const key = `${name}="`;
  const at = tag.indexOf(key);
  if (at < 0) return null;
  const start = at + key.length;
  const end = tag.indexOf('"', start);
  return end < 0 ? null : decodeEntities(tag.slice(start, end));
}

/** Texte visible d'un fragment HTML : balises retirées, espaces regroupés. */
function visibleText(fragment: string): string {
  let out = '';
  let inTag = false;
  for (const c of fragment) {
    if (c === '<') inTag = true;
    else if (c === '>') {
      inTag = false;
      out += ' ';
    } else if (!inTag) out += c;
  }
  return decodeEntities(out).split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Repère les liens de vote de la page `/vote` d'Azuriom : ce sont les balises qui portent
 * `data-vote-id`, quel que soit le thème du site.
 *
 * Lecture par recherche de texte et non avec DOMParser : ce code tourne aussi dans le service
 * worker, où DOMParser n'existe pas.
 */
export function parseSites(html: string, base: string): VoteSiteInfo[] {
  const sites: VoteSiteInfo[] = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf('data-vote-id="', from);
    if (at < 0) break;
    const open = html.lastIndexOf('<', at);
    const start = open < 0 ? at : open;
    const close = html.indexOf('>', at);
    const end = close < 0 ? html.length : close;
    const tag = html.slice(start, end);
    from = end;

    const id = attr(tag, 'data-vote-id');
    const url = attr(tag, 'href');
    if (id === null || url === null) continue;
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;

    // La route de confirmation doit rester sur le site du serveur, jamais ailleurs.
    const declared = attr(tag, 'data-vote-url');
    const voteUrl = declared !== null && declared.startsWith(`${base}/`) ? declared : `${base}/vote/site/${id}`;
    const linkEnd = html.indexOf('</a>', end);
    const label = linkEnd < 0 ? '' : visibleText(html.slice(end + 1, linkEnd));

    sites.push({ id, url, voteUrl, host: hostOf(url), label });
  }
  return sites;
}

export function csrfToken(html: string): string | null {
  const at = html.indexOf('name="csrf-token"');
  if (at < 0) return null;
  const open = html.lastIndexOf('<', at);
  const end = html.indexOf('>', at);
  if (end < 0) return null;
  return attr(html.slice(open < 0 ? at : open, end), 'content');
}
