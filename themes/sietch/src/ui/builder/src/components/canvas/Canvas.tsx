import { useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { clsx } from 'clsx';
import { Layout, Monitor, Tablet, Smartphone } from 'lucide-react';
import { useEditorStore, useThemeStore } from '@stores';
import { CanvasComponent } from './CanvasComponent';
import { DropZone } from './DropZone';
import type { ComponentInstance, ViewportSize } from '@types';

function generateId(): string {
  return `comp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const viewportWidths: Record<ViewportSize, string> = {
  desktop: 'max-w-4xl',
  tablet: 'max-w-2xl',
  mobile: 'max-w-sm',
};

const viewportIcons: Record<ViewportSize, React.ElementType> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

export function Canvas() {
  const theme = useThemeStore((s) => s.theme);
  const activePageId = useEditorStore((s) => s.activePageId);
  const viewport = useEditorStore((s) => s.viewport);
  const setViewport = useEditorStore((s) => s.setViewport);
  const setDragging = useEditorStore((s) => s.setDragging);
  const selectComponent = useEditorStore((s) => s.selectComponent);

  const addComponent = useThemeStore((s) => s.addComponent);
  const deleteComponent = useThemeStore((s) => s.deleteComponent);
  const reorderComponents = useThemeStore((s) => s.reorderComponents);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Get current page
  const currentPage = theme?.pages.find((p) => p.id === activePageId) ||
    theme?.pages[0];

  const handleDragStart = useCallback((_event: DragStartEvent) => {
    setDragging(true);
  }, [setDragging]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(false);

      const { active, over } = event;
      if (!over || !currentPage) return;

      const activeData = active.data.current;
      const overData = over.data.current;

      // New component from palette
      if (activeData?.type === 'new-component') {
        const definition = activeData.definition;
        const newComponent: ComponentInstance = {
          id: generateId(),
          type: definition.type,
          props: { ...definition.defaultProps },
        };

        let insertIndex = currentPage.components.length;

        // If dropping on a drop zone, insert at that position
        if (overData?.type === 'drop-zone') {
          insertIndex = overData.index;
        }
        // If dropping on an existing component, insert after it
        else if (overData?.type === 'existing-component') {
          const existingIndex = currentPage.components.findIndex(
            (c) => c.id === over.id
          );
          insertIndex = existingIndex + 1;
        }

        addComponent(currentPage.id, newComponent, insertIndex);
        selectComponent(newComponent.id);
        return;
      }

      // Reordering existing components
      if (activeData?.type === 'existing-component' && active.id !== over.id) {
        const oldIndex = currentPage.components.findIndex(
          (c) => c.id === active.id
        );
        let newIndex: number;

        if (overData?.type === 'drop-zone') {
          newIndex = overData.index;
          if (newIndex > oldIndex) newIndex--;
        } else {
          newIndex = currentPage.components.findIndex((c) => c.id === over.id);
        }

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          reorderComponents(currentPage.id, oldIndex, newIndex);
        }
      }
    },
    [currentPage, addComponent, reorderComponents, selectComponent, setDragging]
  );

  const handleDelete = useCallback(
    (componentId: string) => {
      if (currentPage) {
        deleteComponent(currentPage.id, componentId);
        selectComponent(null);
      }
    },
    [currentPage, deleteComponent, selectComponent]
  );

  const handleDuplicate = useCallback(
    (componentId: string) => {
      if (!currentPage) return;
      const component = currentPage.components.find((c) => c.id === componentId);
      if (!component) return;

      const duplicated: ComponentInstance = {
        id: generateId(),
        type: component.type,
        props: { ...component.props },
        children: component.children
          ? component.children.map((child) => ({
              ...child,
              id: generateId(),
            }))
          : undefined,
      };

      const index = currentPage.components.findIndex((c) => c.id === componentId);
      addComponent(currentPage.id, duplicated, index + 1);
      selectComponent(duplicated.id);
    },
    [currentPage, addComponent, selectComponent]
  );

  if (!theme) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-100">
        <div className="text-center">
          <Layout size={48} className="mx-auto text-surface-300 mb-4" />
          <p className="text-surface-500">Select or create a theme to start editing</p>
        </div>
      </div>
    );
  }

  if (!currentPage) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-100">
        <div className="text-center">
          <Layout size={48} className="mx-auto text-surface-300 mb-4" />
          <p className="text-surface-500">No pages in this theme</p>
          <button className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg
            hover:bg-primary-600 transition-colors text-sm font-medium">
            Add Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface-100 overflow-hidden">
      {/* Viewport Selector */}
      <div className="flex items-center justify-center gap-2 py-2 bg-white border-b border-surface-200">
        {(['desktop', 'tablet', 'mobile'] as ViewportSize[]).map((vp) => {
          const Icon = viewportIcons[vp];
          return (
            <button
              key={vp}
              onClick={() => setViewport(vp)}
              className={clsx(
                'p-2 rounded-lg transition-colors',
                viewport === vp
                  ? 'bg-primary-100 text-primary-600'
                  : 'text-surface-400 hover:bg-surface-100 hover:text-surface-600'
              )}
              title={vp.charAt(0).toUpperCase() + vp.slice(1)}
            >
              <Icon size={20} />
            </button>
          );
        })}
      </div>

      {/* Canvas Area */}
      <div
        className="flex-1 overflow-auto p-8"
        onClick={() => selectComponent(null)}
      >
        <div
          className={clsx(
            'mx-auto bg-white rounded-lg shadow-sm border border-surface-200 min-h-full transition-all duration-300',
            viewportWidths[viewport]
          )}
        >
          {/* Page Header */}
          <div className="p-4 border-b border-surface-200 bg-surface-50 rounded-t-lg">
            <h3 className="font-medium text-surface-700">{currentPage.name}</h3>
            <p className="text-sm text-surface-500">/{currentPage.slug}</p>
          </div>

          {/* Components */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="p-4 min-h-[400px]">
              {currentPage.components.length === 0 ? (
                <EmptyCanvas />
              ) : (
                <SortableContext
                  items={currentPage.components.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-4">
                    <DropZone id="drop-0" index={0} />
                    {currentPage.components.map((component, index) => (
                      <div key={component.id}>
                        <CanvasComponent
                          instance={component}
                          pageId={currentPage.id}
                          onDelete={handleDelete}
                          onDuplicate={handleDuplicate}
                        />
                        <DropZone id={`drop-${index + 1}`} index={index + 1} />
                      </div>
                    ))}
                  </div>
                </SortableContext>
              )}
            </div>
          </DndContext>
        </div>
      </div>
    </div>
  );
}

function EmptyCanvas() {
  const { isOver, setNodeRef } = useDroppable({
    id: 'empty-canvas',
    data: {
      type: 'drop-zone',
      index: 0,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'h-[300px] flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors',
        isOver
          ? 'border-primary-400 bg-primary-50'
          : 'border-surface-300 bg-surface-50'
      )}
    >
      <Layout size={40} className="text-surface-300 mb-3" />
      <p className="text-surface-500 font-medium">Drop components here</p>
      <p className="text-sm text-surface-400 mt-1">
        Drag from the palette to add components
      </p>
    </div>
  );
}
