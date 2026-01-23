import { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  presets?: string[];
}

const defaultPresets = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#64748b', '#1f2937', '#000000',
];

export function ColorField({
  label,
  value,
  onChange,
  error,
  disabled = false,
  presets = defaultPresets,
}: ColorFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let hex = e.target.value;
    if (!hex.startsWith('#')) {
      hex = '#' + hex;
    }
    // Only update if valid hex or partial
    if (/^#[0-9A-Fa-f]{0,6}$/.test(hex)) {
      onChange(hex);
    }
  };

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => !disabled && setShowPicker(!showPicker)}
            disabled={disabled}
            className={clsx(
              'w-10 h-10 rounded-lg border-2 shadow-sm transition-all',
              error ? 'border-red-300' : 'border-surface-200',
              disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-surface-400'
            )}
            style={{ backgroundColor: value }}
          />
          <input
            type="text"
            value={value}
            onChange={handleHexChange}
            disabled={disabled}
            placeholder="#000000"
            className={clsx(
              'flex-1 px-3 py-2 text-sm font-mono border rounded-lg transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
              error ? 'border-red-300 bg-red-50' : 'border-surface-200 bg-white',
              disabled && 'opacity-50 cursor-not-allowed bg-surface-100'
            )}
          />
        </div>

        {showPicker && (
          <div className="absolute z-50 top-full left-0 mt-2 p-3 bg-white rounded-lg shadow-lg border border-surface-200">
            <div className="grid grid-cols-5 gap-1.5 mb-3">
              {presets.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    onChange(color);
                    setShowPicker(false);
                  }}
                  className={clsx(
                    'w-7 h-7 rounded-md border-2 transition-transform hover:scale-110',
                    value === color ? 'border-primary-500 ring-2 ring-primary-200' : 'border-transparent'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full h-8 cursor-pointer rounded border-0"
            />
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
