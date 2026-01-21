import { clsx } from 'clsx';
import { Minus, Plus } from 'lucide-react';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  disabled?: boolean;
  unit?: string;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  error,
  disabled = false,
  unit,
}: NumberFieldProps) {
  const handleIncrement = () => {
    const newValue = value + step;
    if (max === undefined || newValue <= max) {
      onChange(newValue);
    }
  };

  const handleDecrement = () => {
    const newValue = value - step;
    if (min === undefined || newValue >= min) {
      onChange(newValue);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    if (!isNaN(newValue)) {
      if (min !== undefined && newValue < min) return;
      if (max !== undefined && newValue > max) return;
      onChange(newValue);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={disabled || (min !== undefined && value <= min)}
          className="p-1.5 rounded-lg border border-surface-200 hover:bg-surface-100
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Minus size={14} />
        </button>
        <div className="flex-1 relative">
          <input
            type="number"
            value={value}
            onChange={handleChange}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            className={clsx(
              'w-full px-3 py-2 text-sm text-center border rounded-lg transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
              error ? 'border-red-300 bg-red-50' : 'border-surface-200 bg-white',
              disabled && 'opacity-50 cursor-not-allowed bg-surface-100',
              unit && 'pr-8'
            )}
          />
          {unit && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-surface-400">
              {unit}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleIncrement}
          disabled={disabled || (max !== undefined && value >= max)}
          className="p-1.5 rounded-lg border border-surface-200 hover:bg-surface-100
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
