import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Copie à l'ancienne, qui marche même quand la page de l'extension n'a pas le focus. */
function copyWithSelection(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Copie le pseudo dans le presse-papiers ; sans effet si le presse-papiers est indisponible. */
export function copyPseudo(pseudo: string): Promise<boolean> {
  try {
    return navigator.clipboard.writeText(pseudo).then(
      () => true,
      () => copyWithSelection(pseudo)
    );
  } catch {
    return Promise.resolve(copyWithSelection(pseudo));
  }
}

/** Petit bouton « Copier » à côté du pseudo, pour le coller sur un site de vote qui ne le préremplit pas. */
export function CopyPseudoButton({ pseudo }: { pseudo: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!(await copyPseudo(pseudo))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 align-middle text-xs text-text-muted hover:text-text"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copié' : 'Copier'}
    </button>
  );
}
