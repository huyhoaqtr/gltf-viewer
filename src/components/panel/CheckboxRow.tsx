interface CheckboxRowProps {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

/** Rendered as a switch row: label (+ optional hint) on the left, toggle on the right. */
export function CheckboxRow({ id, label, hint, checked, onChange }: CheckboxRowProps) {
  return (
    <label className="switch-row" htmlFor={id}>
      <span className="switch-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
