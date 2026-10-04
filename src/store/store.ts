import { create } from 'zustand';
import { ACCOUNT_KEY, bindStore, HISTORY_KEY, reviveData, STATE_KEY } from './chromeStorage';
import type { LimerisAccount } from '../sync/limeris';
import {
  applyStatus,
  DEFAULT_SETTINGS,
  MAX_EVENTS,
  patchSite,
  setServerError,
  validateManually,
  type VoteData,
  type VoteEvent,
  type VoteServer,
  type VoteSettings,
  type VoteSite,
} from './types';

export * from './types';

interface VoteStoreState extends VoteData {
  addServer: (server: VoteServer) => void;
  removeServer: (id: string) => void;
  setCurrent: (id: string) => void;
  setServerError: (id: string, error: string | null) => void;
  /** Applique la réponse du site : heure du prochain vote par site + votes du mois. */
  applyStatus: (id: string, sites: Record<string, number | null>, monthVotes: number) => void;
  patchSite: (serverId: string, siteId: string, patch: Partial<VoteSite>) => void;
  /** Vote validé à la main : lance un délai local que le site du serveur ne connaît pas. */
  validateManually: (serverId: string, siteId: string, delayMin: number) => void;
  updateSettings: (patch: Partial<VoteSettings>) => void;
}

export const useVoteStore = create<VoteStoreState>()((set) => ({
  servers: [],
  currentId: null,
  settings: DEFAULT_SETTINGS,
  addServer: (server) => set((s) => ({ servers: [...s.servers, { ...server, identityAt: Date.now() }], currentId: server.id })),
  removeServer: (id) =>
    set((s) => {
      const servers = s.servers.filter((x) => x.id !== id);
      return { servers, removed: [...(s.removed ?? []), id], currentId: s.currentId === id ? (servers[0]?.id ?? null) : s.currentId };
    }),
  setCurrent: (currentId) => set({ currentId }),
  setServerError: (id, error) => set((s) => ({ servers: setServerError(s.servers, id, error) })),
  applyStatus: (id, sites, monthVotes) => set((s) => ({ servers: applyStatus(s.servers, id, sites, monthVotes, Date.now()) })),
  patchSite: (serverId, siteId, patch) => set((s) => ({ servers: patchSite(s.servers, serverId, siteId, patch) })),
  validateManually: (serverId, siteId, delayMin) =>
    set((s) => ({ servers: validateManually(s.servers, serverId, siteId, delayMin, Date.now()) })),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch }, settingsAt: Date.now() })),
}));

interface VoteHistoryState {
  events: VoteEvent[];
  push: (event: VoteEvent) => void;
  clear: () => void;
}

/** Historique des votes, enregistré à part des réglages : il grossit avec le temps. */
export const useVoteHistoryStore = create<VoteHistoryState>()((set) => ({
  events: [],
  push: (event) => set((s) => ({ events: [...s.events, { ...event, id: event.id ?? crypto.randomUUID() }].slice(-MAX_EVENTS) })),
  clear: () => set({ events: [] }),
}));

interface AccountState {
  /** Compte limeris.fr connecté, ou null. Écrit par le service worker quand le site remet le jeton. */
  account: LimerisAccount | null;
  setAccount: (account: LimerisAccount | null) => void;
}

export const useAccountStore = create<AccountState>()((set) => ({
  account: null,
  setAccount: (account) => set({ account }),
}));

/** Tenue une fois les données enregistrées chargées : les écrans attendent ça pour s'afficher. */
export const storeReady: Promise<unknown> = Promise.all([
  bindStore<AccountState, { account: LimerisAccount | null }>(
    useAccountStore,
    ACCOUNT_KEY,
    ({ account }) => ({ account }),
    (saved) => ({ account: saved?.account ?? null })
  ),
  bindStore<VoteStoreState, VoteData>(
    useVoteStore,
    STATE_KEY,
    ({ servers, currentId, settings, settingsAt, removed }) => ({ servers, currentId, settings, settingsAt, removed }),
    reviveData
  ),
  bindStore<VoteHistoryState, { events: VoteEvent[] }>(
    useVoteHistoryStore,
    HISTORY_KEY,
    ({ events }) => ({ events }),
    (saved) => ({ events: saved?.events ?? [] })
  ),
]);
