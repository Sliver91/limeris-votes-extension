export const SITE_URL = 'https://limeris.fr';

/** Lien vers le site de Limeris, ouvert dans un nouvel onglet. */
export function SiteLink({ className = '' }: { className?: string }) {
  return (
    <a href={SITE_URL} target="_blank" rel="noreferrer" className={`text-accent hover:underline ${className}`}>
      limeris.fr
    </a>
  );
}

/** Logo Limeris, nom de l'extension et lien vers le site : l'en-tête de chaque écran. */
export function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <a href={SITE_URL} target="_blank" rel="noreferrer" title="Ouvrir limeris.fr" className="shrink-0">
        <img src="icons/128.png" alt="Limeris" width={32} height={32} className="h-8 w-8 rounded-lg" />
      </a>
      <div className="min-w-0 leading-tight">
        <h1 className="truncate text-sm font-semibold text-text">Limeris VOTES</h1>
        <SiteLink className="text-xs" />
      </div>
    </div>
  );
}
