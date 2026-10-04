import { useAccountStore } from '../store/store';
import { describeSyncError, isTokenShaped, SYNC_ERR, SYNC_KEY, syncNow, type LimerisAccount } from '../sync/limeris';

/**
 * Synchronise depuis un écran (bouton « Synchroniser »). Renvoie le message d'erreur à afficher,
 * ou `null` si tout s'est bien passé. Un jeton refusé déconnecte l'extension : l'écran affiche
 * alors l'avertissement « accès retiré », pas une erreur.
 */
export async function syncFromScreen(): Promise<string | null> {
  const { account, setAccount } = useAccountStore.getState();
  if (!account) return null;
  try {
    await syncNow(account);
    const current = useAccountStore.getState().account;
    if (current?.connectedAt === account.connectedAt) setAccount({ ...current, lastSyncAt: Date.now() });
    return null;
  } catch (e) {
    if (String(e).includes(SYNC_ERR.TOKEN)) {
      setAccount(null, 'revoked');
      await chrome.storage.local.remove(SYNC_KEY);
      return null;
    }
    return describeSyncError(e);
  }
}

/**
 * Connexion par le code de secours affiché sur limeris.fr, quand la page n'a pas pu remettre le
 * jeton à l'extension. C'est le premier échange avec limeris.fr qui dit si le code est valable.
 */
export async function connectWithCode(code: string): Promise<string | null> {
  const token = code.trim();
  if (!isTokenShaped(token)) return "Ce code n'a pas la bonne forme. Copie-le en entier depuis limeris.fr.";
  const account: LimerisAccount = { token, pseudo: '', connectedAt: Date.now(), lastSyncAt: null };
  try {
    await syncNow(account);
  } catch (e) {
    if (String(e).includes(SYNC_ERR.TOKEN)) return "limeris.fr ne reconnaît pas ce code. Crée-en un nouveau depuis limeris.fr, puis réessaie.";
    return describeSyncError(e);
  }
  useAccountStore.getState().setAccount({ ...account, lastSyncAt: Date.now() });
  return null;
}
