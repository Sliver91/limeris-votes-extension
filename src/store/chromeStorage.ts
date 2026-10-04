import { DEFAULT_SETTINGS, MAX_EVENTS, VOTE_SOUNDS, type VoteData, type VoteEvent } from './types';
import type { AccountNotice, LimerisAccount } from '../sync/limeris';

/**
 * Enregistrement dans le navigateur (chrome.storage.local), partagé entre le panneau, la fenêtre
 * de l'icône et le service worker. Tout le stockage passe par ce fichier ; la synchronisation
 * avec le compte limeris.fr (sync/limeris.ts) lit et écrit par lui.
 */

/** Mêmes noms que dans Limeris. */
export const STATE_KEY = 'limeris-minecraft-votes';
export const HISTORY_KEY = 'limeris-minecraft-votes-history';

/** Complète ce qui a été enregistré par une version plus ancienne (réglages ajoutés depuis). */
export function reviveData(saved: Partial<VoteData> | undefined): VoteData {
  const settings = { ...DEFAULT_SETTINGS, ...saved?.settings };
  // Un son retiré depuis (Carillon, Cloche, Discret) est remplacé par celui par défaut.
  if (!VOTE_SOUNDS.includes(settings.soundKind)) settings.soundKind = DEFAULT_SETTINGS.soundKind;
  return {
    servers: saved?.servers ?? [],
    currentId: saved?.currentId ?? null,
    settings,
    settingsAt: saved?.settingsAt,
    removed: saved?.removed ?? [],
  };
}

export async function readData(): Promise<VoteData> {
  const got = await chrome.storage.local.get(STATE_KEY);
  return reviveData(got[STATE_KEY]);
}

export async function writeData(data: VoteData): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: data });
}

export async function readHistory(): Promise<VoteEvent[]> {
  const got = await chrome.storage.local.get(HISTORY_KEY);
  return got[HISTORY_KEY]?.events ?? [];
}

export async function writeHistory(events: VoteEvent[]): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_KEY]: { events: events.slice(-MAX_EVENTS) } });
}

export async function appendHistory(events: VoteEvent[]): Promise<void> {
  if (events.length === 0) return;
  const got = await chrome.storage.local.get(HISTORY_KEY);
  const previous: VoteEvent[] = got[HISTORY_KEY]?.events ?? [];
  await chrome.storage.local.set({ [HISTORY_KEY]: { events: [...previous, ...events].slice(-MAX_EVENTS) } });
}

/** Compte limeris.fr connecté à cette extension. Rangé à part : il ne quitte jamais cet appareil. */
export const ACCOUNT_KEY = 'limeris-votes-account';

export async function readAccount(): Promise<LimerisAccount | null> {
  const got = await chrome.storage.local.get(ACCOUNT_KEY);
  return got[ACCOUNT_KEY]?.account ?? null;
}

/** `notice` dit pourquoi l'extension n'est plus connectée quand l'utilisateur ne l'a pas demandé. */
export async function writeAccount(account: LimerisAccount | null, notice: AccountNotice | null = null): Promise<void> {
  await chrome.storage.local.set({ [ACCOUNT_KEY]: { account, notice } });
}

interface BindableStore<S> {
  getState: () => S;
  setState: (partial: Partial<S>) => void;
  subscribe: (listener: (state: S) => void) => () => void;
}

/**
 * Relie un store à une clé du stockage : charge la valeur enregistrée, enregistre chaque
 * changement, et reprend ceux faits ailleurs (service worker, autre écran de l'extension).
 * La promesse est tenue une fois la valeur enregistrée chargée.
 */
export async function bindStore<S, P extends object>(
  store: BindableStore<S>,
  key: string,
  pick: (state: S) => P,
  revive: (saved: Partial<P> | undefined) => P
): Promise<void> {
  // Vrai pendant qu'on applique une valeur venue du stockage, pour ne pas la réécrire aussitôt.
  let applying = false;
  let last = '';

  const apply = (value: P) => {
    applying = true;
    store.setState(value as unknown as Partial<S>);
    applying = false;
  };

  const got = await chrome.storage.local.get(key);
  apply(revive(got[key]));
  last = JSON.stringify(pick(store.getState()));

  store.subscribe((state) => {
    if (applying) return;
    const picked = pick(state);
    const json = JSON.stringify(picked);
    if (json === last) return;
    last = json;
    chrome.storage.local.set({ [key]: picked });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(key in changes)) return;
    const next = revive(changes[key].newValue);
    const json = JSON.stringify(next);
    if (json === last) return;
    last = json;
    apply(next);
  });
}
