import { clsx } from 'clsx';

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  multiline = false,
  rows = 3,
  disabled = false,
}: TextFieldProps) {
  const inputClasses = clsx(
    'w-full px-3 py-2 text-sm border rounded-lg transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
    error
      ? 'border-red-300 bg-red-50'
      : 'border-surface-200 bg-white',
    disabled && 'opacity-50 cursor-not-allowed bg-surface-100'
  );

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={inputClasses}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={inputClasses}
        />
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
