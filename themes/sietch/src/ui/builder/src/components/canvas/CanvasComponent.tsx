import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import { GripVertical, Trash2, Copy, Settings } from 'lucide-react';
import { useEditorStore, useComponentStore, selectComponentByType } from '@stores';
import type { ComponentInstance } from '@types';

interface CanvasComponentProps {
  instance: ComponentInstance;
  pageId: string;
  onDelete: (componentId: string) => void;
  onDuplicate: (componentId: string) => void;
}

export function CanvasComponent({
  instance,
  pageId,
  onDelete,
  onDuplicate,
}: CanvasComponentProps) {
  const selectedComponentId = useEditorStore((s) => s.selectedComponentId);
  const selectComponent = useEditorStore((s) => s.selectComponent);
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);
  const definition = useComponentStore((s) => selectComponentByType(s, instance.type));

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: instance.id,
    data: {
      type: 'existing-component',
      instanceId: instance.id,
      pageId,
    },
    disabled: isPreviewMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isSelected = selectedComponentId === instance.id;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isPreviewMode) {
      selectComponent(instance.id);
    }
  };

  if (isPreviewMode) {
    return (
      <div className="p-4 bg-white rounded-lg border border-surface-200">
        <ComponentPreview instance={instance} definition={definition} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleClick}
      className={clsx(
        'group relative bg-white rounded-lg border-2 transition-all',
        isDragging && 'opacity-50 shadow-lg',
        isSelected
          ? 'border-primary-500 shadow-sm'
          : 'border-surface-200 hover:border-surface-300'
      )}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className={clsx(
          'absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center',
          'cursor-grab active:cursor-grabbing',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'bg-surface-50 rounded-l-lg border-r border-surface-200'
        )}
      >
        <GripVertical size={16} className="text-surface-400" />
      </div>

      {/* Component Content */}
      <div className="p-4 pl-10">
        <ComponentPreview instance={instance} definition={definition} />
      </div>

      {/* Actions */}
      {isSelected && (
        <div className="absolute -top-3 right-2 flex gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(instance.id);
            }}
            className="p-1.5 bg-white rounded shadow-sm border border-surface-200
              hover:bg-surface-50 transition-colors"
            title="Duplicate"
          >
            <Copy size={14} className="text-surface-600" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Open properties panel - will be implemented in Sprint 8
            }}
            className="p-1.5 bg-white rounded shadow-sm border border-surface-200
              hover:bg-surface-50 transition-colors"
            title="Settings"
          >
            <Settings size={14} className="text-surface-600" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(instance.id);
            }}
            className="p-1.5 bg-white rounded shadow-sm border border-red-200
              hover:bg-red-50 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} className="text-red-500" />
          </button>
        </div>
      )}

      {/* Type Label */}
      <div className="absolute -bottom-2 left-10 px-2 py-0.5 bg-surface-100
        rounded text-xs text-surface-500 font-medium">
        {definition?.name || instance.type}
      </div>
    </div>
  );
}

// Simple preview rendering
function ComponentPreview({
  instance,
  definition,
}: {
  instance: ComponentInstance;
  definition: ReturnType<typeof selectComponentByType>;
}) {
  // This would be replaced with actual component rendering in a full implementation
  // For MVP, we show a placeholder with the component info
  return (
    <div className="min-h-[60px] flex items-center justify-center text-sm text-surface-500">
      <div className="text-center">
        <p className="font-medium text-surface-700">
          {definition?.name || instance.type}
        </p>
        <p className="text-xs mt-1">
          {Object.keys(instance.props).length} props configured
        </p>
      </div>
    </div>
  );
}
