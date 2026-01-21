import { useState } from 'react';
import { Palette, Type, Square, Image, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { useThemeStore } from '@stores';
import { ColorPicker } from './ColorPicker';
import { FontSelector } from './FontSelector';

type Section = 'colors' | 'fonts' | 'layout' | 'logo';

const borderRadiusOptions = [
  { value: 'none', label: 'None', preview: 'rounded-none' },
  { value: 'sm', label: 'Small', preview: 'rounded-sm' },
  { value: 'md', label: 'Medium', preview: 'rounded-md' },
  { value: 'lg', label: 'Large', preview: 'rounded-lg' },
  { value: 'full', label: 'Full', preview: 'rounded-full' },
];

const spacingOptions = [
  { value: 'compact', label: 'Compact', description: 'Minimal spacing' },
  { value: 'comfortable', label: 'Comfortable', description: 'Balanced spacing' },
  { value: 'spacious', label: 'Spacious', description: 'Generous spacing' },
];

export function BrandingEditor() {
  const [expandedSection, setExpandedSection] = useState<Section | null>('colors');
  const theme = useThemeStore((s) => s.theme);
  const updateColors = useThemeStore((s) => s.updateColors);
  const updateFonts = useThemeStore((s) => s.updateFonts);
  const updateBranding = useThemeStore((s) => s.updateBranding);

  if (!theme) return null;

  const { branding } = theme;

  const toggleSection = (section: Section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="space-y-2">
      {/* Colors Section */}
      <div className="border border-surface-200 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('colors')}
          className="w-full flex items-center justify-between p-3 bg-surface-50 hover:bg-surface-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-primary-500" />
            <span className="text-sm font-medium">Colors</span>
          </div>
          {expandedSection === 'colors' ? (
            <ChevronUp size={16} className="text-surface-400" />
          ) : (
            <ChevronDown size={16} className="text-surface-400" />
          )}
        </button>
        {expandedSection === 'colors' && (
          <div className="p-3 space-y-3 border-t border-surface-200">
            <ColorPicker
              label="Primary"
              value={branding.colors.primary}
              onChange={(value) => updateColors({ primary: value })}
            />
            <ColorPicker
              label="Secondary"
              value={branding.colors.secondary}
              onChange={(value) => updateColors({ secondary: value })}
            />
            <ColorPicker
              label="Accent"
              value={branding.colors.accent}
              onChange={(value) => updateColors({ accent: value })}
            />
            <ColorPicker
              label="Background"
              value={branding.colors.background}
              onChange={(value) => updateColors({ background: value })}
            />
            <ColorPicker
              label="Surface"
              value={branding.colors.surface}
              onChange={(value) => updateColors({ surface: value })}
            />
            <ColorPicker
              label="Text"
              value={branding.colors.text}
              onChange={(value) => updateColors({ text: value })}
            />
          </div>
        )}
      </div>

      {/* Fonts Section */}
      <div className="border border-surface-200 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('fonts')}
          className="w-full flex items-center justify-between p-3 bg-surface-50 hover:bg-surface-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Type size={16} className="text-primary-500" />
            <span className="text-sm font-medium">Typography</span>
          </div>
          {expandedSection === 'fonts' ? (
            <ChevronUp size={16} className="text-surface-400" />
          ) : (
            <ChevronDown size={16} className="text-surface-400" />
          )}
        </button>
        {expandedSection === 'fonts' && (
          <div className="p-3 space-y-3 border-t border-surface-200">
            <FontSelector
              label="Heading Font"
              value={branding.fonts.heading.family}
              onChange={(value) => updateFonts({ heading: { ...branding.fonts.heading, family: value } })}
            />
            <FontSelector
              label="Body Font"
              value={branding.fonts.body.family}
              onChange={(value) => updateFonts({ body: { ...branding.fonts.body, family: value } })}
            />
          </div>
        )}
      </div>

      {/* Layout Section */}
      <div className="border border-surface-200 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('layout')}
          className="w-full flex items-center justify-between p-3 bg-surface-50 hover:bg-surface-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Square size={16} className="text-primary-500" />
            <span className="text-sm font-medium">Layout</span>
          </div>
          {expandedSection === 'layout' ? (
            <ChevronUp size={16} className="text-surface-400" />
          ) : (
            <ChevronDown size={16} className="text-surface-400" />
          )}
        </button>
        {expandedSection === 'layout' && (
          <div className="p-3 space-y-4 border-t border-surface-200">
            {/* Border Radius */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-600">Border Radius</label>
              <div className="grid grid-cols-5 gap-2">
                {borderRadiusOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateBranding({ borderRadius: option.value as any })}
                    className={clsx(
                      'p-2 border-2 transition-colors',
                      option.preview,
                      branding.borderRadius === option.value
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-surface-200 hover:border-surface-300'
                    )}
                    title={option.label}
                  >
                    <div
                      className={clsx(
                        'w-full aspect-square bg-primary-500',
                        option.preview
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Spacing */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-600">Spacing</label>
              <div className="space-y-2">
                {spacingOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateBranding({ spacing: option.value as any })}
                    className={clsx(
                      'w-full p-2 text-left rounded-lg border-2 transition-colors',
                      branding.spacing === option.value
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-surface-200 hover:border-surface-300'
                    )}
                  >
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs text-surface-500">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Logo Section */}
      <div className="border border-surface-200 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('logo')}
          className="w-full flex items-center justify-between p-3 bg-surface-50 hover:bg-surface-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Image size={16} className="text-primary-500" />
            <span className="text-sm font-medium">Logo & Assets</span>
          </div>
          {expandedSection === 'logo' ? (
            <ChevronUp size={16} className="text-surface-400" />
          ) : (
            <ChevronDown size={16} className="text-surface-400" />
          )}
        </button>
        {expandedSection === 'logo' && (
          <div className="p-3 border-t border-surface-200">
            <div className="border-2 border-dashed border-surface-300 rounded-lg p-6 text-center">
              <Image size={32} className="mx-auto text-surface-300 mb-2" />
              <p className="text-sm text-surface-500 mb-2">Upload logo</p>
              <button className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg
                hover:bg-primary-600 transition-colors">
                Choose File
              </button>
              <p className="text-xs text-surface-400 mt-2">PNG, SVG up to 2MB</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
