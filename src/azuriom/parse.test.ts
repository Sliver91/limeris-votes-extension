import { describe, expect, it } from 'vitest';
import { csrfToken, normalizeBase, parseSites, parseVoteLinks } from './parse';
import { checkUser, fetchSites } from './client';

// Mêmes cas que les tests de minecraft_votes.rs.
const PAGE = `<head><meta name="csrf-token" content="abc123"></head>
        <a class="btn" href="https://serveur-minecraft.com/5179" target="_blank"
           data-vote-id="1"
           data-vote-url="https://monserveur.fr/vote/site/1" style="x">
            <span class="badge vote-timer"></span> <span><i class="fas"></i> Site-1</span>
        </a>
        <a class="btn" href="https://top-serveurs.net/minecraft/vote/mon-serveur?pseudo={player}&amp;ref=1"
           data-vote-id="3" data-vote-url="https://ailleurs.example/vote/site/3">Top Serveurs</a>
        <a href="/relatif" data-vote-id="9">Ignoré</a>`;

describe('parseSites', () => {
  it('lit les liens de vote Azuriom', () => {
    const sites = parseSites(PAGE, 'https://monserveur.fr');
    expect(sites).toHaveLength(2);
    expect(sites[0].id).toBe('1');
    expect(sites[0].host).toBe('serveur-minecraft.com');
    expect(sites[0].label).toBe('Site-1');
    expect(sites[0].voteUrl).toBe('https://monserveur.fr/vote/site/1');
    expect(sites[1].url).toBe('https://top-serveurs.net/minecraft/vote/mon-serveur?pseudo={player}&ref=1');
    expect(sites[1].label).toBe('Top Serveurs');
    // Une route de confirmation qui pointe hors du site du serveur est remplacée.
    expect(sites[1].voteUrl).toBe('https://monserveur.fr/vote/site/3');
  });
});

describe('csrfToken', () => {
  it('lit le jeton dans la balise meta', () => {
    expect(csrfToken(PAGE)).toBe('abc123');
    expect(csrfToken('<html></html>')).toBeNull();
  });
});

describe('normalizeBase', () => {
  it('retire le chemin /vote', () => {
    expect(normalizeBase('atheramc.fr/vote')).toBe('https://atheramc.fr');
    expect(normalizeBase(' https://atheramc.fr/ ')).toBe('https://atheramc.fr');
    expect(normalizeBase('http://localhost:8080/site/vote/')).toBe('http://localhost:8080/site');
  });

  it('refuse autre chose que http et https', () => {
    expect(() => normalizeBase('ftp://atheramc.fr')).toThrow('BAD_URL');
    expect(() => normalizeBase('')).toThrow('BAD_URL');
  });
});

// Lecture réelle d'un site Azuriom — hors suite normale. Sous PowerShell :
//   $env:LIVE_SITE='https://atheramc.fr'; $env:LIVE_PSEUDO='MonPseudo'; npm test
const liveSite = process.env.LIVE_SITE;
const livePseudo = process.env.LIVE_PSEUDO;

describe.runIf(liveSite && livePseudo)('site réel', () => {
  it('lit les sites de vote et le statut du pseudo', async () => {
    const info = await fetchSites(liveSite!);
    console.log(`${info.sites.length} sites sur ${info.baseUrl}`);
    for (const s of info.sites) console.log(`  ${s.id} | ${s.host} | ${s.label} | ${s.voteUrl}`);
    expect(info.sites.length).toBeGreaterThan(0);

    const status = await checkUser(info.baseUrl, livePseudo!);
    console.log(`votes du mois : ${status.votes} |`, status.sites);
    expect(typeof status.votes).toBe('number');
  }, 30_000);
});

describe('parseVoteLinks', () => {
  it('garde un lien par ligne, sans doublon', () => {
    expect(parseVoteLinks(' https://top-serveurs.net/arksa/fr-larche-oubliee-694ac9ebd4609\n\nserveur-prive.net/ark/mon-serveur\nhttps://top-serveurs.net/arksa/fr-larche-oubliee-694ac9ebd4609')).toEqual([
      'https://top-serveurs.net/arksa/fr-larche-oubliee-694ac9ebd4609',
      'https://serveur-prive.net/ark/mon-serveur',
    ]);
  });

  it('refuse ce qui n\'est pas un lien http', () => {
    expect(() => parseVoteLinks('javascript:alert(1)')).toThrow('BAD_URL');
    expect(() => parseVoteLinks('pas un lien')).toThrow('BAD_URL');
    expect(() => parseVoteLinks('  ')).toThrow('BAD_URL');
  });
});
