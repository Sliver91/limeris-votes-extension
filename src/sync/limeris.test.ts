import { describe, expect, it } from 'vitest';
import { isLimerisSender, MSG_CONNECT, parseConnectMessage } from './limeris';

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
