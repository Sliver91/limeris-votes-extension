import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeSyncError, isLimerisSender, MSG_CONNECT, parseConnectMessage, SYNC_ERR, SYNC_KEY, syncNow, type LimerisAccount } from './limeris';
import { HISTORY_KEY, STATE_KEY } from '../store/chromeStorage';
import { DEFAULT_SETTINGS, type VoteData, type VoteEvent } from '../store/types';
import type { WirePush } from './wire';

const TOKEN = 'lvt_0123456789abcdef0123456789abcdef';

describe('isLimerisSender', () => {
  it("n'accepte que les pages de limeris.fr", () => {
    expect(isLimerisSender({ origin: 'https://limeris.fr' })).toBe(true);
    expect(isLimerisSender({ url: 'https://www.limeris.fr/votes/connexion-extension' })).toBe(true);
    expect(isLimerisSender({ origin: 'http://limeris.fr' })).toBe(false);
    expect(isLimerisSender({ origin: 'https://limeris.fr.exemple.com' })).toBe(false);
    expect(isLimerisSender({ url: 'https://exemple.com/?https://limeris.fr' })).toBe(false);
    expect(isLimerisSender({ url: 'pas une adresse' })).toBe(false);
    expect(isLimerisSender({})).toBe(false);
  });
});

describe('parseConnectMessage', () => {
  it('lit un message de connexion valide', () => {
    expect(parseConnectMessage({ type: MSG_CONNECT, token: TOKEN, pseudo: 'Sliver91' }, 1000)).toEqual({
      token: TOKEN,
      pseudo: 'Sliver91',
      connectedAt: 1000,
      lastSyncAt: null,
    });
  });

  it('refuse un message mal formé', () => {
    expect(parseConnectMessage(null, 0)).toBeNull();
    expect(parseConnectMessage({ type: 'autre', token: TOKEN }, 0)).toBeNull();
    expect(parseConnectMessage({ type: MSG_CONNECT, token: 'court' }, 0)).toBeNull();
    expect(parseConnectMessage({ type: MSG_CONNECT, token: `${TOKEN} avec espace` }, 0)).toBeNull();
    expect(parseConnectMessage({ type: MSG_CONNECT, token: 42 }, 0)).toBeNull();
  });
});

describe('syncNow', () => {
  const SERVER_ID = '3f0c8a52-6a3e-4c7b-9a51-0c1d2e3f4a5b';
  const account: LimerisAccount = { token: TOKEN, pseudo: 'Sliver91', connectedAt: 1000, lastSyncAt: null };
  const server = {
    id: SERVER_ID,
    name: 'srv.fr',
    baseUrl: 'https://srv.fr',
    pseudo: 'Joueur',
    identityAt: 5,
    sites: [{ id: '1', url: 'https://top.example/vote', voteUrl: 'https://srv.fr/vote/site/1', host: 'top.example', label: 'Top', nextAt: null, notified: true, lastRemindAt: null, updatedAt: 5 }],
    monthVotes: 2,
    lastCheckedAt: 5,
    error: null,
  };
  const event = { id: 'evenement-1', t: 2000, serverId: SERVER_ID, host: 'top.example', siteId: '1', kind: 'v' as const };

  let storage: Record<string, unknown>;
  let calls: { url: string; init: RequestInit }[];

  /** Stockage du navigateur et limeris.fr, simulés : la réponse reprend ce qui a été envoyé. */
  function install(respond: (url: string, body: WirePush | null) => { status: number; json: unknown }) {
    storage = {
      [STATE_KEY]: { servers: [server], currentId: SERVER_ID, settings: DEFAULT_SETTINGS, removed: [] },
      [HISTORY_KEY]: { events: [event] },
    };
    calls = [];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: storage[key] }),
          set: async (values: Record<string, unknown>) => void Object.assign(storage, structuredClone(values)),
          remove: async (key: string) => void delete storage[key],
        },
      },
    });
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const { status, json } = respond(url, init.body ? (JSON.parse(init.body as string) as WirePush) : null);
      return { status, ok: status >= 200 && status < 300, json: async () => json } as Response;
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("envoie l'état et l'historique avec le jeton, puis applique la réponse du compte", async () => {
    install((_url, body) => ({
      status: 200,
      json: {
        succes: true,
        revision: 3,
        heureServeur: 9000,
        serveurs: body!.serveurs.map((s) => ({ ...s, nom: 'Renommé ailleurs' })),
        suppressions: [],
        parametres: null,
        evenements: [{ id: 'evenement-2', date: 1500, serveurId: SERVER_ID, siteId: '1', hote: 'top.example', type: 'v', manuel: false, recompense: null }],
        curseur: 7,
        suite: false,
      },
    }));

    await syncNow(account);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://limeris.fr/api/votes/v1/synchro');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const sent = JSON.parse(calls[0].init.body as string) as WirePush;
    expect(sent.serveurs[0].id).toBe(SERVER_ID);
    expect(sent.evenements.map((e) => e.id)).toEqual(['evenement-1']);
    expect(sent.depuis).toBe(0);

    expect((storage[STATE_KEY] as VoteData).servers[0].name).toBe('Renommé ailleurs');
    expect((storage[HISTORY_KEY] as { events: VoteEvent[] }).events.map((e) => e.id)).toEqual(['evenement-2', 'evenement-1']);
    expect(storage[SYNC_KEY]).toMatchObject({ connectedAt: 1000, cursor: 7 });
  });

  it("ne renvoie pas l'historique déjà envoyé, et repart du curseur", async () => {
    install((_url, body) => ({
      status: 200,
      json: { succes: true, revision: 3, heureServeur: 9000, serveurs: body!.serveurs, suppressions: [], parametres: null, evenements: [], curseur: 7, suite: false },
    }));
    storage[SYNC_KEY] = { connectedAt: 1000, cursor: 7, sentUntil: 5000 };

    await syncNow(account);

    const sent = JSON.parse(calls[0].init.body as string) as WirePush;
    expect(sent.evenements).toEqual([]);
    expect(sent.depuis).toBe(7);
  });

  it("lit la suite de l'historique quand le compte en a plus qu'une réponse", async () => {
    install((url, body) => ({
      status: 200,
      json: {
        succes: true,
        revision: 3,
        heureServeur: 9000,
        serveurs: body ? body.serveurs : [{ ...JSON.parse(calls[0].init.body as string).serveurs[0] }],
        suppressions: [],
        parametres: null,
        evenements: [],
        curseur: url.includes('/etat') ? 20 : 10,
        suite: !url.includes('/etat'),
      },
    }));

    await syncNow(account);

    expect(calls.map((c) => c.url)).toEqual(['https://limeris.fr/api/votes/v1/synchro', 'https://limeris.fr/api/votes/v1/etat?depuis=10']);
    expect(storage[SYNC_KEY]).toMatchObject({ cursor: 20 });
  });

  it('signale un jeton refusé sans toucher aux données', async () => {
    install(() => ({ status: 401, json: { succes: false, erreur: 'Jeton invalide, expiré ou révoqué.', code: 'JETON_REFUSE' } }));
    const before = JSON.stringify(storage);

    await expect(syncNow(account)).rejects.toThrow(SYNC_ERR.TOKEN);
    expect(JSON.stringify(storage)).toBe(before);
    expect(describeSyncError(new Error(SYNC_ERR.TOKEN))).toContain('reconnecte');
  });

  it('rapporte le message de limeris.fr quand les données sont refusées', async () => {
    install(() => ({ status: 422, json: { succes: false, erreur: 'Trop de serveurs suivis (50 au maximum).' } }));
    const error = await syncNow(account).catch((e: unknown) => e);
    expect(describeSyncError(error)).toBe('limeris.fr a refusé la synchronisation : Trop de serveurs suivis (50 au maximum).');
  });
});
