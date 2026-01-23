import { ChevronDown } from 'lucide-react';

interface FontSelectorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const fontOptions = [
  { value: 'Inter', label: 'Inter', category: 'Sans Serif' },
  { value: 'Roboto', label: 'Roboto', category: 'Sans Serif' },
  { value: 'Open Sans', label: 'Open Sans', category: 'Sans Serif' },
  { value: 'Poppins', label: 'Poppins', category: 'Sans Serif' },
  { value: 'Montserrat', label: 'Montserrat', category: 'Sans Serif' },
  { value: 'Lato', label: 'Lato', category: 'Sans Serif' },
  { value: 'Source Sans Pro', label: 'Source Sans Pro', category: 'Sans Serif' },
  { value: 'Raleway', label: 'Raleway', category: 'Sans Serif' },
  { value: 'Playfair Display', label: 'Playfair Display', category: 'Serif' },
  { value: 'Merriweather', label: 'Merriweather', category: 'Serif' },
  { value: 'Georgia', label: 'Georgia', category: 'Serif' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono', category: 'Monospace' },
  { value: 'Fira Code', label: 'Fira Code', category: 'Monospace' },
];

export function FontSelector({ label, value, onChange }: FontSelectorProps) {
  const groupedFonts = fontOptions.reduce((acc, font) => {
    if (!acc[font.category]) acc[font.category] = [];
    acc[font.category].push(font);
    return acc;
  }, {} as Record<string, typeof fontOptions>);

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full p-2 pr-8 text-sm border border-surface-200 rounded-lg appearance-none
            focus:outline-none focus:ring-2 focus:ring-primary-500"
          style={{ fontFamily: value }}
        >
          {Object.entries(groupedFonts).map(([category, fonts]) => (
            <optgroup key={category} label={category}>
              {fonts.map((font) => (
                <option
                  key={font.value}
                  value={font.value}
                  style={{ fontFamily: font.value }}
                >
                  {font.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none"
        />
      </div>
      <p className="text-xs text-surface-500" style={{ fontFamily: value }}>
        The quick brown fox jumps over the lazy dog
      </p>
    </div>
  );
}
