import { describe, expect, it } from 'vitest';
import { checkServers, countAvailable, isQuietHour, nextDeadline } from './engine';
import { DEFAULT_SETTINGS, type VoteData, type VoteSite } from '../store/types';

const NOW = new Date(2026, 9, 4, 15, 0, 0).getTime();

function site(id: string, patch: Partial<VoteSite>): VoteSite {
  return { id, url: `https://${id}.example`, voteUrl: `https://srv.fr/vote/site/${id}`, host: `${id}.example`, label: id, nextAt: null, notified: false, lastRemindAt: null, ...patch };
}

function data(sites: VoteSite[], settings: Partial<VoteData['settings']> = {}): VoteData {
  return {
    currentId: 's',
    settings: { ...DEFAULT_SETTINGS, ...settings },
    servers: [{ id: 's', name: 'srv.fr', baseUrl: 'https://srv.fr', pseudo: 'Joueur', sites, monthVotes: 0, lastCheckedAt: null, error: null }],
  };
}

describe('checkServers', () => {
  it('signale une seule fois les sites redevenus disponibles', () => {
    const result = checkServers(data([site('a', { nextAt: NOW - 1 }), site('b', { nextAt: NOW - 1 }), site('c', { nextAt: NOW + 60_000 })]), NOW);
    expect(result.notices).toEqual([expect.objectContaining({ count: 2, reminder: false })]);
    expect(result.events.map((e) => e.host)).toEqual(['a.example', 'b.example']);
    expect(result.servers[0].sites.map((s) => s.notified)).toEqual([true, true, false]);

    const again = checkServers({ ...data([]), servers: result.servers }, NOW + 15_000);
    expect(again.changed).toBe(false);
    expect(again.notices).toHaveLength(0);
  });

  it('relance après le délai choisi', () => {
    const waiting = [site('a', { notified: true, lastRemindAt: NOW - 11 * 60_000 })];
    expect(checkServers(data(waiting), NOW).notices).toEqual([expect.objectContaining({ count: 1, reminder: true })]);
    expect(checkServers(data(waiting, { remindMinutes: 0 }), NOW).notices).toHaveLength(0);
  });

  it('ne signale rien pendant la plage de silence, puis tout à sa fin', () => {
    const sites = [site('a', { nextAt: NOW - 1 })];
    const quiet = { quietNight: true, quietFrom: 14, quietTo: 16 };
    expect(checkServers(data(sites, quiet), NOW).changed).toBe(false);
    expect(checkServers(data(sites, quiet), NOW + 3_600_000).notices).toHaveLength(1);
  });

  it("garde l'historique mais n'envoie rien quand les notifications sont coupées", () => {
    const result = checkServers(data([site('a', { nextAt: NOW - 1 })], { notify: false }), NOW);
    expect(result.notices).toHaveLength(0);
    expect(result.events).toHaveLength(1);
    expect(result.changed).toBe(true);
  });
});

describe('plage de silence', () => {
  it('peut passer minuit', () => {
    expect(isQuietHour(new Date(2026, 0, 1, 23, 30), 23, 8)).toBe(true);
    expect(isQuietHour(new Date(2026, 0, 1, 7, 59), 23, 8)).toBe(true);
    expect(isQuietHour(new Date(2026, 0, 1, 8, 0), 23, 8)).toBe(false);
    expect(isQuietHour(new Date(2026, 0, 1, 12, 0), 9, 9)).toBe(false);
  });
});

describe('icône et prochain réveil', () => {
  it('compte les votes disponibles et trouve la prochaine échéance', () => {
    const { servers } = data([site('a', {}), site('b', { nextAt: NOW + 5_000 }), site('c', { nextAt: NOW + 2_000 })]);
    expect(countAvailable(servers, NOW)).toBe(1);
    expect(nextDeadline(servers, NOW)).toBe(NOW + 2_000);
    expect(nextDeadline(data([site('a', {})]).servers, NOW)).toBeNull();
  });
});
