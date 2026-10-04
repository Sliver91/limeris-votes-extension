interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <label className="flex min-w-0 items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-surface-alt p-0.5
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2
          disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className={`h-5 w-5 rounded-full transition-[transform,background-color] duration-200 ease-out
            ${checked ? 'translate-x-5 bg-accent' : 'translate-x-0 bg-text-muted'}`}
        />
      </button>
      {label && <span className="min-w-0 text-sm text-text">{label}</span>}
    </label>
  );
}
