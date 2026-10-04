import { isAvailable, openEventId, type VoteData, type VoteEvent, type VoteServer } from '../store/types';

/** Vrai si l'heure tombe dans la plage de silence — qui peut passer minuit (23 h → 8 h). */
export function isQuietHour(date: Date, from: number, to: number): boolean {
  const h = date.getHours();
  if (from === to) return false;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

export interface Notice {
  server: VoteServer;
  count: number;
  reminder: boolean;
}

export interface CheckResult {
  servers: VoteServer[];
  /** Sites redevenus disponibles, à ajouter à l'historique. */
  events: VoteEvent[];
  /** Notifications à envoyer : une seule par serveur et par passage, jamais une par site. */
  notices: Notice[];
  changed: boolean;
}

/**
 * Repère les sites redevenus disponibles et ceux à relancer. Repris de useVoteEngine.ts, mais
 * sans effet de bord : le service worker enregistre le résultat et envoie les notifications.
 */
export function checkServers(data: VoteData, now: number): CheckResult {
  const { settings } = data;
  const result: CheckResult = { servers: data.servers, events: [], notices: [], changed: false };
  // Pendant la plage de silence, rien n'est signalé : tout part ensemble à la fin de la plage.
  if (settings.quietNight && isQuietHour(new Date(now), settings.quietFrom, settings.quietTo)) return result;

  result.servers = data.servers.map((server) => {
    let fresh = 0;
    let reminded = 0;
    const sites = server.sites.map((site) => {
      if (!isAvailable(site, now)) return site;
      if (!site.notified) {
        result.events.push({ id: openEventId(server.id, site.id, site.nextAt, now), t: now, serverId: server.id, host: site.host, siteId: site.id, kind: 'o' });
        fresh += 1;
        return { ...site, notified: true, lastRemindAt: now };
      }
      if (settings.notify && settings.remindMinutes > 0 && now - (site.lastRemindAt ?? 0) >= settings.remindMinutes * 60_000) {
        reminded += 1;
        return { ...site, lastRemindAt: now };
      }
      return site;
    });
    if (fresh + reminded === 0) return server;
    result.changed = true;
    if (settings.notify) {
      result.notices.push(fresh > 0 ? { server, count: fresh, reminder: false } : { server, count: reminded, reminder: true });
    }
    return { ...server, sites };
  });
  return result;
}

/** Nombre de votes disponibles, tous serveurs confondus — affiché sur l'icône. */
export function countAvailable(servers: VoteServer[], now: number): number {
  return servers.reduce((n, server) => n + server.sites.filter((site) => isAvailable(site, now)).length, 0);
}

/** Heure du prochain site à redevenir disponible, ou null si aucun délai ne court. */
export function nextDeadline(servers: VoteServer[], now: number): number | null {
  let next: number | null = null;
  for (const server of servers) {
    for (const site of server.sites) {
      if (site.nextAt !== null && site.nextAt > now && (next === null || site.nextAt < next)) next = site.nextAt;
    }
  }
  return next;
}
