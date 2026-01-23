import { useDroppable } from '@dnd-kit/core';
import { clsx } from 'clsx';
import { Plus } from 'lucide-react';

interface DropZoneProps {
  id: string;
  index: number;
  isActive?: boolean;
}

export function DropZone({ id, index, isActive = false }: DropZoneProps) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: {
      type: 'drop-zone',
      index,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'h-2 -my-1 mx-4 rounded-full transition-all duration-200',
        isOver || isActive
          ? 'h-16 my-2 bg-primary-50 border-2 border-dashed border-primary-300 flex items-center justify-center'
          : 'hover:h-4 hover:my-0 hover:bg-surface-200'
      )}
    >
      {(isOver || isActive) && (
        <div className="flex items-center gap-2 text-primary-500">
          <Plus size={16} />
          <span className="text-sm font-medium">Drop here</span>
        </div>
      )}
    </div>
  );
}
