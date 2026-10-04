import { checkUser, confirmVote, type VoteUserStatus } from '../azuriom/client';
import { appendHistory, readAccount, readData, reviveData, STATE_KEY, writeAccount, writeData } from '../store/chromeStorage';
import { BRIDGE_ERR, findServer, findSite } from '../sync/bridge';
import {
  isLimerisSender,
  MSG_CHECK,
  MSG_CONFIRM,
  MSG_CONNECT,
  MSG_OPEN,
  MSG_PING,
  parseConnectMessage,
  SYNC_ERR,
  SYNC_KEY,
  syncNow,
} from '../sync/limeris';
import { syncFingerprint } from '../sync/wire';
import { applyStatus, setServerError, type VoteServer, type VoteSound } from '../store/types';
import { checkServers, countAvailable, nextDeadline, type Notice } from './engine';

/**
 * Surveille les délais de vote même quand aucun écran de l'extension n'est ouvert. Le navigateur
 * endort ce script entre deux réveils : rien n'est gardé en mémoire, tout repart du stockage.
 */

/** Contrôle régulier, pour les relances et la fin de la plage de silence. */
const TICK_ALARM = 'tick';
/**
 * Resynchronisation avec le site du serveur : rattrape les votes faits ailleurs que dans l'extension.
 * Suivie d'un échange avec le compte limeris.fr, s'il est connecté.
 */
const REFRESH_ALARM = 'refresh';
/** Réveil à l'heure exacte où le prochain site redevient disponible. */
const NEXT_ALARM = 'next';
const REFRESH_MINUTES = 10;

const NOTIFICATION_PREFIX = 'votes:';
const BADGE_COLOR = '#0071e3';
const SOUND_MESSAGE = 'limeris-play-sound';

async function ensureAlarms() {
  if (!(await chrome.alarms.get(TICK_ALARM))) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  if (!(await chrome.alarms.get(REFRESH_ALARM))) chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
}

/** Met à jour le nombre sur l'icône et programme le réveil du prochain vote. */
async function updateSurface(servers: VoteServer[], now: number) {
  const count = countAvailable(servers, now);
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  const next = nextDeadline(servers, now);
  if (next !== null) chrome.alarms.create(NEXT_ALARM, { when: next + 500 });
  else chrome.alarms.clear(NEXT_ALARM);
}

async function notify({ server, count, reminder }: Notice) {
  const id = NOTIFICATION_PREFIX + server.id;
  // Recréer une notification déjà affichée ne la fait pas réapparaître : on la retire d'abord.
  await chrome.notifications.clear(id);
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title: reminder ? 'Rappel de vote' : 'Vote disponible',
    message: `${count} vote${count > 1 ? 's' : ''} disponible${count > 1 ? 's' : ''} pour ${server.name}.`,
  });
}

/** Le service worker ne peut pas jouer de son : une page invisible le fait pour lui. */
async function playSound(sound: VoteSound, volume: number) {
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Jouer le son du rappel de vote.',
      });
    }
    await chrome.runtime.sendMessage({ type: SOUND_MESSAGE, sound, volume });
  } catch (e) {
    console.warn('[limeris-votes] son indisponible :', e);
  }
}

async function check() {
  const data = await readData();
  const now = Date.now();
  const result = checkServers(data, now);
  if (result.changed) await writeData({ ...data, servers: result.servers });
  await appendHistory(result.events);
  for (const notice of result.notices) await notify(notice);
  if (result.notices.length > 0 && data.settings.sound) await playSound(data.settings.soundKind, data.settings.volume);
  await updateSurface(result.servers, now);
}

async function refreshAll() {
  const { servers } = await readData();
  const answers = await Promise.all(
    servers.map(async (server): Promise<[string, VoteUserStatus | string]> => {
      try {
        return [server.id, await checkUser(server.baseUrl, server.pseudo)];
      } catch (e) {
        return [server.id, String(e)];
      }
    })
  );
  // Relecture après les appels réseau : un écran a pu modifier les données entre-temps.
  const data = await readData();
  const now = Date.now();
  let next = data.servers;
  for (const [id, answer] of answers) {
    next = typeof answer === 'string' ? setServerError(next, id, answer) : applyStatus(next, id, answer.sites, answer.votes, now);
  }
  if (answers.length > 0) await writeData({ ...data, servers: next });
  await check();
}

/** Empreinte des données au dernier échange réussi : sert à savoir s'il y a du nouveau à envoyer. */
const FINGERPRINT_KEY = 'syncFingerprint';
/** Délai après un changement avant de l'envoyer : regroupe ceux qui se suivent (vote + relecture). */
const SYNC_DELAY_MS = 2_500;

let syncing = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Échange avec le compte limeris.fr quand l'extension y est connectée. Un échec passager (pas de
 * réseau, site indisponible) ne bloque rien : l'essai suivant, ou le bouton « Synchroniser », le dira.
 * Un jeton refusé déconnecte l'extension : le garder ne ferait que répéter la même erreur.
 */
async function syncAccount() {
  if (syncing) return;
  const account = await readAccount();
  if (!account) return;
  syncing = true;
  try {
    await syncNow(account);
    // Relecture : l'utilisateur a pu se déconnecter ou se reconnecter pendant l'échange.
    const current = await readAccount();
    if (current?.connectedAt === account.connectedAt) await writeAccount({ ...current, lastSyncAt: Date.now() });
    await chrome.storage.session.set({ [FINGERPRINT_KEY]: syncFingerprint(await readData()) });
  } catch (e) {
    if (String(e).includes(SYNC_ERR.TOKEN)) {
      const current = await readAccount();
      if (current?.connectedAt === account.connectedAt) {
        await writeAccount(null, 'revoked');
        await chrome.storage.local.remove(SYNC_KEY);
      }
    } else {
      console.warn('[limeris-votes] synchronisation impossible :', e);
    }
  } finally {
    syncing = false;
  }
}

/** Un changement local (vote, serveur ajouté, paramètre) part vers le compte peu après. */
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (!(await readAccount())) return;
    const known = (await chrome.storage.session.get(FINGERPRINT_KEY))[FINGERPRINT_KEY];
    // Rien à envoyer si les données sont celles du dernier échange (c'est lui qui vient d'écrire).
    if (syncFingerprint(await readData()) !== known) syncAccount();
  }, SYNC_DELAY_MS);
}

/** Relit les délais d'un serveur suivi, à la demande de la page limeris.fr/votes. */
async function bridgeCheck(message: { baseUrl?: unknown }) {
  const data = await readData();
  const server = findServer(data.servers, message.baseUrl);
  if (!server) return { ok: false, error: BRIDGE_ERR.UNKNOWN_SERVER };
  try {
    const status = await checkUser(server.baseUrl, server.pseudo);
    const fresh = await readData();
    await writeData({ ...fresh, servers: applyStatus(fresh.servers, server.id, status.sites, status.votes, Date.now()) });
    return { ok: true, result: status };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

/** Demande au site d'un serveur suivi si un vote est validé, à la demande de la page limeris.fr/votes. */
async function bridgeConfirm(message: { baseUrl?: unknown; voteUrl?: unknown; gameServer?: unknown }) {
  const data = await readData();
  const server = findServer(data.servers, message.baseUrl);
  const site = server && findSite(server, message.voteUrl);
  if (!server || !site) return { ok: false, error: BRIDGE_ERR.UNKNOWN_SERVER };
  if (message.gameServer !== undefined && typeof message.gameServer !== 'string') return { ok: false, error: BRIDGE_ERR.BAD_REQUEST };
  try {
    const result = await confirmVote(server.baseUrl, site.voteUrl, server.pseudo, message.gameServer);
    // Vote validé : les délais de l'extension suivent tout de suite, sans attendre la relecture régulière.
    if (result.status === 'done') void bridgeCheck({ baseUrl: server.baseUrl });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

/** Affiche l'outil : l'écran déjà ouvert s'il y en a un, sinon un nouvel onglet. */
async function showPanel() {
  const url = chrome.runtime.getURL('panel.html');
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.TAB, chrome.runtime.ContextType.SIDE_PANEL],
    documentUrls: [url],
  });
  const tab = contexts.find((c) => c.tabId >= 0);
  const open = tab ?? contexts[0];
  if (!open) {
    await chrome.tabs.create({ url });
    return;
  }
  if (tab) await chrome.tabs.update(tab.tabId, { active: true });
  if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshAll().then(syncAccount);
  else check();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms();
  refreshAll().then(syncAccount);
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  refreshAll().then(syncAccount);
});

// Un écran vient de modifier les données (vote confirmé, serveur ajouté…) : l'icône et le
// prochain réveil suivent. Rien n'est écrit ici, donc pas de boucle avec les écrans.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(STATE_KEY in changes)) return;
  updateSurface(reviveData(changes[STATE_KEY].newValue).servers, Date.now());
  scheduleSync();
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return;
  chrome.notifications.clear(id);
  const serverId = id.slice(NOTIFICATION_PREFIX.length);
  const data = await readData();
  if (data.currentId !== serverId && data.servers.some((s) => s.id === serverId)) {
    await writeData({ ...data, currentId: serverId });
  }
  await showPanel();
});

// Messages de la page limeris.fr (seules ses pages peuvent en envoyer, voir le manifeste ; l'origine
// est revérifiée ici). `ping` lui dit si l'extension est là, `connect` lui remet le jeton du compte,
// `open` affiche l'outil, `check` et `confirm` interrogent le site d'un serveur déjà suivi.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isLimerisSender(sender)) return;
  if (message?.type === MSG_PING) {
    readAccount().then((account) =>
      sendResponse({
        ok: true,
        version: chrome.runtime.getManifest().version,
        connected: account !== null,
        accountId: account?.accountId ?? null,
      })
    );
    return true;
  }
  if (message?.type === MSG_CONNECT) {
    const account = parseConnectMessage(message, Date.now());
    if (!account) {
      sendResponse({ ok: false });
      return;
    }
    writeAccount(account).then(() => {
      sendResponse({ ok: true });
      // Premier échange tout de suite : les serveurs de l'appareil arrivent sur limeris.fr/votes.
      syncAccount();
    });
    return true;
  }
  if (message?.type === MSG_OPEN) {
    showPanel().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === MSG_CHECK) {
    bridgeCheck(message).then(sendResponse);
    return true;
  }
  if (message?.type === MSG_CONFIRM) {
    bridgeConfirm(message).then(sendResponse);
    return true;
  }
});

ensureAlarms();
