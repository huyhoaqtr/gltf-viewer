interface CheckboxRowProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function CheckboxRow({ id, label, checked, onChange }: CheckboxRowProps) {
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
