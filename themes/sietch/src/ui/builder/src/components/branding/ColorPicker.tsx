import { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const colorPresets = [
  // Blues
  '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af',
  // Purples
  '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6',
  // Greens
  '#22c55e', '#16a34a', '#15803d', '#166534',
  // Oranges
  '#f97316', '#ea580c', '#c2410c', '#9a3412',
  // Neutrals
  '#f5f5f5', '#d4d4d4', '#737373', '#262626',
];

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
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

  return (
    <div className="space-y-1" ref={containerRef}>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="flex items-center gap-2 w-full p-2 rounded-lg border border-surface-200
            hover:border-surface-300 transition-colors"
        >
          <div
            className="w-6 h-6 rounded shadow-sm border border-black/10"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono text-sm text-gray-700">{value}</span>
        </button>

        {showPicker && (
          <div className="absolute z-50 top-full left-0 mt-2 p-3 bg-white rounded-lg shadow-xl border border-surface-200 w-56">
            <div className="grid grid-cols-4 gap-2 mb-3">
              {colorPresets.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    onChange(color);
                    setShowPicker(false);
                  }}
                  className={clsx(
                    'w-10 h-10 rounded-lg border-2 transition-transform hover:scale-105',
                    value === color
                      ? 'border-primary-500 ring-2 ring-primary-200'
                      : 'border-transparent'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-10 h-10 cursor-pointer rounded border-0 p-0"
              />
              <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex-1 px-2 text-sm font-mono border border-surface-200 rounded-lg"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
