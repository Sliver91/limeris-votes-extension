import { ERR } from './azuriom/errors';
import type { OpenMode } from './store/types';

/** Ce que l'extension demande au navigateur depuis ses écrans — l'équivalent de tauriBridge.ts. */

/** Onglet dans lequel s'ouvrent les sites de vote, réutilisé d'un site au suivant. */
let voteTabId: number | null = null;

function httpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(ERR.BAD_URL);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(ERR.BAD_URL);
  return parsed.href;
}

/** Ouvre un site de vote dans un onglet ou une petite fenêtre, en réutilisant celui déjà ouvert. */
export async function openSite(url: string, mode: OpenMode): Promise<void> {
  const href = httpUrl(url);
  if (voteTabId !== null) {
    try {
      const tab = await chrome.tabs.update(voteTabId, { url: href, active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      // L'onglet a été fermé entre-temps : on en ouvre un autre.
      voteTabId = null;
    }
  }
  if (mode === 'window') {
    const created = await chrome.windows.create({ url: href, type: 'popup', width: 560, height: 780 });
    voteTabId = created?.tabs?.[0]?.id ?? null;
  } else {
    const tab = await chrome.tabs.create({ url: href, active: true });
    voteTabId = tab.id ?? null;
  }
}

export async function closeSite(): Promise<void> {
  if (voteTabId === null) return;
  const id = voteTabId;
  voteTabId = null;
  await chrome.tabs.remove(id).catch(() => {});
}

/** Ouvre un lien externe dans un nouvel onglet. */
export function openExternal(url: string): void {
  chrome.tabs.create({ url: httpUrl(url) });
}

/**
 * Demande l'accès au site du serveur, pour lui seulement. À appeler directement depuis un clic :
 * le navigateur refuse la demande si elle arrive après une attente.
 */
export function requestSiteAccess(base: string): Promise<boolean> {
  const url = new URL(base);
  const host = url.hostname.replace(/^(www\.)+/, '');
  // Un nom de domaine couvre aussi ses sous-domaines (redirection vers www, par exemple).
  const isDomain = host.includes('.') && !/^[\d.]+$/.test(host);
  const origin = `${url.protocol}//${isDomain ? `*.${host}` : url.hostname}/*`;
  return chrome.permissions.request({ origins: [origin] }).catch(() => false);
}

const PENDING_QUEUE_KEY = 'pendingQueue';

export interface PendingQueue {
  serverId: string;
  siteIds: string[];
}

/** File de vote demandée depuis la fenêtre de l'icône, que le panneau lance à son ouverture. */
export function setPendingQueue(queue: PendingQueue): void {
  chrome.storage.session.set({ [PENDING_QUEUE_KEY]: queue });
}

export async function takePendingQueue(): Promise<PendingQueue | null> {
  const got = await chrome.storage.session.get(PENDING_QUEUE_KEY);
  const queue = got[PENDING_QUEUE_KEY] as PendingQueue | undefined;
  if (!queue) return null;
  await chrome.storage.session.remove(PENDING_QUEUE_KEY);
  return queue;
}

export function onPendingQueue(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'session' && changes[PENDING_QUEUE_KEY]?.newValue) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

const PENDING_TAB_KEY = 'pendingTab';

/** Onglet demandé depuis la fenêtre de l'icône (« Paramètres »), que le panneau affiche à son ouverture. */
export function setPendingTab(tab: string): void {
  chrome.storage.session.set({ [PENDING_TAB_KEY]: tab });
}

export async function takePendingTab(): Promise<string | null> {
  const got = await chrome.storage.session.get(PENDING_TAB_KEY);
  const tab = got[PENDING_TAB_KEY] as string | undefined;
  if (!tab) return null;
  await chrome.storage.session.remove(PENDING_TAB_KEY);
  return tab;
}

export function onPendingTab(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'session' && changes[PENDING_TAB_KEY]?.newValue) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/**
 * Ouvre l'outil complet dans le panneau latéral de la fenêtre donnée, ou dans un onglet si le
 * panneau n'est pas disponible. À appeler directement depuis un clic.
 */
export async function openPanel(windowId: number | undefined): Promise<void> {
  if (chrome.sidePanel?.open && windowId !== undefined) {
    try {
      await chrome.sidePanel.open({ windowId });
      return;
    } catch {
      // Panneau latéral refusé par ce navigateur : on passe par un onglet.
    }
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
}
