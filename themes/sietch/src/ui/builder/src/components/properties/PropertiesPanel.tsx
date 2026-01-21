import { useMemo } from 'react';
import { Settings, Trash2 } from 'lucide-react';
import { useEditorStore, useThemeStore, useComponentStore, selectComponentByType } from '@stores';
import { PropertyField } from './PropertyField';

export function PropertiesPanel() {
  const selectedComponentId = useEditorStore((s) => s.selectedComponentId);
  const activePageId = useEditorStore((s) => s.activePageId);
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);
  const selectComponent = useEditorStore((s) => s.selectComponent);

  const theme = useThemeStore((s) => s.theme);
  const updateComponent = useThemeStore((s) => s.updateComponent);
  const deleteComponent = useThemeStore((s) => s.deleteComponent);

  // Get selected component instance
  const selectedComponent = useMemo(() => {
    if (!theme || !activePageId || !selectedComponentId) return null;
    const page = theme.pages.find((p) => p.id === activePageId);
    return page?.components.find((c) => c.id === selectedComponentId) || null;
  }, [theme, activePageId, selectedComponentId]);

  // Get component definition
  const definition = useComponentStore((s) =>
    selectedComponent ? selectComponentByType(s, selectedComponent.type) : undefined
  );

  if (isPreviewMode) {
    return null;
  }

  if (!selectedComponent || !definition) {
    return (
      <aside className="w-72 bg-white border-l border-surface-200 flex flex-col">
        <div className="p-4 border-b border-surface-200">
          <h2 className="text-lg font-semibold text-gray-900">Properties</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <Settings size={40} className="mx-auto text-surface-300 mb-3" />
            <p className="text-sm text-surface-500">
              Select a component to edit its properties
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const handlePropChange = (propName: string, value: unknown) => {
    if (!activePageId || !selectedComponentId) return;
    updateComponent(activePageId, selectedComponentId, {
      props: {
        ...selectedComponent.props,
        [propName]: value,
      },
    });
  };

  const handleDelete = () => {
    if (!activePageId || !selectedComponentId) return;
    deleteComponent(activePageId, selectedComponentId);
    selectComponent(null);
  };

  // Parse component schema into property fields
  const schemaProperties = definition.schema?.properties || {};

  return (
    <aside className="w-72 bg-white border-l border-surface-200 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-surface-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{definition.name}</h2>
            <p className="text-xs text-surface-500">{definition.category}</p>
          </div>
          <button
            onClick={handleDelete}
            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete component"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto">
        {Object.keys(schemaProperties).length > 0 ? (
          <div className="p-4 space-y-4">
            {Object.entries(schemaProperties).map(([propName, propSchema]) => (
              <PropertyField
                key={propName}
                name={propName}
                schema={propSchema as any}
                value={selectedComponent.props[propName]}
                onChange={(value) => handlePropChange(propName, value)}
              />
            ))}
          </div>
        ) : (
          <div className="p-4 text-center text-sm text-surface-500">
            No configurable properties
          </div>
        )}
      </div>

      {/* Footer with component info */}
      <div className="p-4 border-t border-surface-200 bg-surface-50">
        <div className="text-xs text-surface-500 space-y-1">
          <div className="flex justify-between">
            <span>Type:</span>
            <span className="font-mono text-surface-700">{selectedComponent.type}</span>
          </div>
          <div className="flex justify-between">
            <span>ID:</span>
            <span className="font-mono text-surface-700 truncate max-w-[140px]">
              {selectedComponent.id}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
