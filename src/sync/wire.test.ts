import { describe, expect, it } from 'vitest';
import { applyRemote, buildPush, mergeEvents, syncFingerprint, toWireEvent, type WireState } from './wire';
import { applyStatus, DEFAULT_SETTINGS, openEventId, validateManually, type VoteData, type VoteEvent, type VoteSite } from '../store/types';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const SERVER_ID = '3f0c8a52-6a3e-4c7b-9a51-0c1d2e3f4a5b';

function site(patch: Partial<VoteSite> = {}): VoteSite {
  return { id: '1', url: 'https://top.example/vote', voteUrl: 'https://srv.fr/vote/site/1', host: 'top.example', label: 'Top', nextAt: null, notified: true, lastRemindAt: NOW - HOUR, ...patch };
}

function data(sites: VoteSite[], patch: Partial<VoteData> = {}): VoteData {
  return {
    currentId: SERVER_ID,
    settings: DEFAULT_SETTINGS,
    removed: [],
    servers: [{ id: SERVER_ID, name: 'srv.fr', baseUrl: 'https://srv.fr', pseudo: 'Joueur', sites, monthVotes: 2, lastCheckedAt: NOW - HOUR, error: null }],
    ...patch,
  };
}

function remoteOf(local: VoteData, patch: Partial<WireState> = {}): WireState {
  const push = buildPush(local, [], 0);
  return { revision: 1, heureServeur: NOW, serveurs: push.serveurs, suppressions: [], parametres: push.parametres ?? null, evenements: [], curseur: 0, suite: false, ...patch };
}

describe('dates de modification', () => {
  it('validateManually date le changement, applyStatus seulement si le délai change', () => {
    const manual = validateManually(data([site()]).servers, SERVER_ID, '1', 180, NOW);
    expect(manual[0].sites[0].updatedAt).toBe(NOW);

    // Relecture qui n'apprend rien (le délai manuel court toujours) : la date ne bouge pas.
    const same = applyStatus(manual, SERVER_ID, { '1': null }, 3, NOW + HOUR);
    expect(same[0].sites[0].updatedAt).toBe(NOW);
    expect(same[0].sites[0].nextAt).toBe(NOW + 3 * HOUR);

    const changed = applyStatus(data([site({ updatedAt: 5 })]).servers, SERVER_ID, { '1': NOW + 2 * HOUR }, 3, NOW);
    expect(changed[0].sites[0].updatedAt).toBe(NOW);
  });
});

describe('buildPush', () => {
  it("n'envoie pas des paramètres jamais modifiés", () => {
    expect(buildPush(data([site()]), [], 0).parametres).toBeUndefined();
    expect(buildPush(data([site()], { settingsAt: NOW }), [], 0).parametres?.modifieLe).toBe(NOW);
  });

  it('ne tient pas compte de ce qui est propre à l’appareil', () => {
    const a = data([site({ notified: true, lastRemindAt: 1 })]);
    const b = data([site({ notified: false, lastRemindAt: 2 })], { currentId: null });
    expect(syncFingerprint(a)).toBe(syncFingerprint(b));
  });
});

describe('applyRemote', () => {
  it('garde les signalements de l’appareil quand le délai ne change pas', () => {
    const local = data([site({ nextAt: NOW - 10, notified: true, lastRemindAt: NOW - 5 })]);
    const next = applyRemote(local, remoteOf(local), NOW);
    expect(next.servers[0].sites[0]).toMatchObject({ notified: true, lastRemindAt: NOW - 5 });
  });

  it('remet le signalement à zéro quand un autre appareil a lancé un délai', () => {
    const local = data([site({ nextAt: null, notified: true })]);
    const voted = data([site({ nextAt: NOW + 3 * HOUR, localUntil: NOW + 3 * HOUR, manualDelayMin: 180, updatedAt: NOW })]);
    const next = applyRemote(local, remoteOf(voted), NOW);
    expect(next.servers[0].sites[0]).toMatchObject({ nextAt: NOW + 3 * HOUR, manualDelayMin: 180, notified: false, lastRemindAt: null });
  });

  it('ne signale pas un site déjà disponible sur un serveur venu du compte', () => {
    const next = applyRemote(data([], { servers: [], currentId: null }), remoteOf(data([site()])), NOW);
    expect(next.currentId).toBe(SERVER_ID);
    expect(next.servers[0].sites[0].notified).toBe(true);
  });

  it('retire un serveur supprimé ailleurs et garde celui que le compte ne connaît pas encore', () => {
    const local = data([site()], { removed: ['x'] });
    const gone = applyRemote(local, remoteOf(local, { serveurs: [], suppressions: [SERVER_ID, 'x'] }), NOW);
    expect(gone.servers).toEqual([]);
    expect(gone.currentId).toBeNull();
    expect(gone.removed).toEqual([]);

    const kept = applyRemote(local, remoteOf(local, { serveurs: [] }), NOW);
    expect(kept.servers).toHaveLength(1);
    expect(kept.removed).toEqual(['x']);
  });

  it('prend les paramètres du compte, sauf un son inconnu de cette version', () => {
    const local = data([site()]);
    const remote = remoteOf(data([site()], { settingsAt: NOW, settings: { ...DEFAULT_SETTINGS, volume: 0.2 } }));
    remote.parametres = { ...remote.parametres!, sonType: 'son-du-futur' };
    const next = applyRemote(local, remote, NOW);
    expect(next.settings.volume).toBe(0.2);
    expect(next.settings.soundKind).toBe(DEFAULT_SETTINGS.soundKind);
    expect(next.settingsAt).toBe(NOW);
  });
});

describe('événements', () => {
  const vote: VoteEvent = { id: 'abcdefgh', t: NOW, serverId: SERVER_ID, host: 'top.example', kind: 'v', manual: true };

  it('deux appareils donnent le même identifiant à la même disponibilité', () => {
    expect(openEventId(SERVER_ID, '1', NOW, NOW + 5)).toBe(openEventId(SERVER_ID, '1', NOW, NOW + 60_000));
    expect(openEventId(SERVER_ID, '1', NOW, NOW)).not.toBe(openEventId(SERVER_ID, '2', NOW, NOW));
    expect(openEventId(SERVER_ID, '1', NOW, NOW)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('un ancien événement sans identifiant en reçoit toujours le même', () => {
    const old: VoteEvent = { t: NOW, serverId: SERVER_ID, host: 'top.example', kind: 'o' };
    expect(toWireEvent(old).id).toBe(toWireEvent({ ...old }).id);
    expect(toWireEvent(old).id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('fusionne sans doublon, dans l’ordre du temps', () => {
    const earlier = { ...toWireEvent(vote), id: 'zzzzzzzz', date: NOW - HOUR };
    expect(mergeEvents([vote], [toWireEvent(vote)])).toEqual([vote]);
    expect(mergeEvents([vote], [earlier]).map((e) => e.id)).toEqual(['zzzzzzzz', 'abcdefgh']);
  });
});
