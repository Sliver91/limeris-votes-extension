/** Codes d'erreur stables, les mêmes que dans Limeris (minecraft_votes.rs). */
export const ERR = {
  BAD_URL: 'BAD_URL',
  NETWORK: 'NETWORK_ERROR',
  NO_SITES: 'NO_SITES',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  /** Propre à l'extension : l'utilisateur a refusé l'accès au site du serveur. */
  ACCESS_DENIED: 'ACCESS_DENIED',
  /** Propre à l'extension : le site refuse la session du navigateur, même après en avoir rouvert une. */
  SESSION_REFUSED: 'SESSION_REFUSED',
} as const;

/** Traduit les codes d'erreur en phrases lisibles. */
export function describeVoteError(error: unknown): string {
  const code = String(error);
  if (code.includes(ERR.BAD_URL)) return "Cette adresse n'est pas valide. Colle l'adresse du site du serveur, par exemple https://monserveur.fr.";
  if (code.includes(ERR.ACCESS_DENIED)) return "L'extension a besoin de l'accès à ce site pour lire sa page de vote. Autorise-le, puis réessaie.";
  if (code.includes(ERR.NO_SITES)) return "Aucun site de vote trouvé à cette adresse. Vérifie que c'est bien le site du serveur et qu'il a une page de vote.";
  if (code.includes(ERR.USER_NOT_FOUND)) return "Ce pseudo n'a pas de compte sur le site du serveur. Crée ton compte sur le site, puis réessaie.";
  if (code.includes(ERR.AUTH_REQUIRED)) return 'Ce serveur demande d\'être connecté à son site pour voter. Connecte-toi sur le site du serveur dans ce navigateur, puis réessaie.';
  if (code.includes(ERR.RATE_LIMITED)) return 'Le site du serveur demande de patienter un peu. Réessaie dans une minute.';
  if (code.includes(ERR.SITE_NOT_FOUND)) return 'Ce site de vote a été retiré par le serveur. Supprime le serveur puis ajoute-le de nouveau pour mettre la liste à jour.';
  if (code.includes(ERR.SESSION_REFUSED)) return "Le site du serveur refuse la session de l'extension. Si tu as bien voté, valide avec « J'ai voté ».";
  if (code.includes(ERR.NETWORK)) return 'Le site du serveur ne répond pas. Vérifie ta connexion, puis réessaie.';
  return 'Le site du serveur a renvoyé une erreur. Réessaie dans un instant.';
}
