const TONES = {
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
} as const;

interface GaugeProps {
  /** Avancement, de 0 à 1. */
  value: number;
  label: string;
  /** `gradient` : du bleu au vert, pour la jauge principale. */
  tone?: keyof typeof TONES | 'gradient';
  className?: string;
}

/** Jauge d'avancement horizontale. */
export function Gauge({ value, label, tone = 'gradient', className = '' }: GaugeProps) {
  const ratio = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className={`h-2 overflow-hidden rounded-full bg-surface-alt ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${tone === 'gradient' ? '' : TONES[tone]}`}
        style={{
          width: `${ratio * 100}%`,
          // Le dégradé couvre toute la jauge, pas seulement la partie remplie.
          ...(tone === 'gradient' && ratio > 0
            ? { backgroundImage: 'linear-gradient(90deg, var(--accent), #10b981)', backgroundSize: `${100 / ratio}% 100%` }
            : {}),
        }}
      />
    </div>
  );
}
