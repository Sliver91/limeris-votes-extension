import { describe, expect, it } from 'vitest';
import { findServer, findSite } from './bridge';
import type { VoteServer } from '../store/types';

const server: VoteServer = {
  id: 's',
  name: 'srv.fr',
  baseUrl: 'https://srv.fr',
  pseudo: 'Joueur',
  monthVotes: 0,
  lastCheckedAt: null,
  error: null,
  sites: [{ id: '1', url: 'https://top.example/vote', voteUrl: 'https://srv.fr/vote/site/1', host: 'top.example', label: 'Top', nextAt: null, notified: true, lastRemindAt: null }],
};

describe('findServer', () => {
  it("ne retrouve que les serveurs suivis par l'extension", () => {
    expect(findServer([server], 'https://srv.fr')).toBe(server);
    expect(findServer([server], 'srv.fr/vote')).toBe(server);
    expect(findServer([server], 'https://autre.example')).toBeNull();
    expect(findServer([server], 'https://srv.fr.autre.example')).toBeNull();
    expect(findServer([server], 'ftp://srv.fr')).toBeNull();
    expect(findServer([server], 42)).toBeNull();
    expect(findServer([], 'https://srv.fr')).toBeNull();
  });
});

describe('findSite', () => {
  it("n'accepte que les routes de confirmation enregistrées", () => {
    expect(findSite(server, 'https://srv.fr/vote/site/1')?.id).toBe('1');
    expect(findSite(server, 'https://srv.fr/vote/site/2')).toBeNull();
    expect(findSite(server, 'https://autre.example/vote/site/1')).toBeNull();
    expect(findSite(server, undefined)).toBeNull();
  });
});
