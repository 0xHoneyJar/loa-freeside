import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle } from 'lucide-react';
import { useComponentStore, selectFilteredComponents } from '@stores';
import { ComponentCard } from './ComponentCard';
import { CategoryFilter } from './CategoryFilter';
import { SearchInput } from './SearchInput';
import { fetchComponents } from '@api/components';

export function ComponentPalette() {
  const setDefinitions = useComponentStore((s) => s.setDefinitions);
  const setLoading = useComponentStore((s) => s.setLoading);
  const setError = useComponentStore((s) => s.setError);
  const filteredComponents = useComponentStore(selectFilteredComponents);
  const isLoading = useComponentStore((s) => s.isLoading);
  const error = useComponentStore((s) => s.error);

  const { data, isLoading: queryLoading, error: queryError } = useQuery({
    queryKey: ['components'],
    queryFn: fetchComponents,
    staleTime: 1000 * 60 * 10, // 10 minutes
  });

  // Sync query state with store
  useEffect(() => {
    setLoading(queryLoading);
  }, [queryLoading, setLoading]);

  useEffect(() => {
    if (queryError) {
      setError(queryError instanceof Error ? queryError.message : 'Failed to load components');
    }
  }, [queryError, setError]);

  useEffect(() => {
    if (data) {
      setDefinitions(data);
    }
  }, [data, setDefinitions]);

  return (
    <aside className="w-64 bg-white border-r border-surface-200 flex flex-col h-full">
      <div className="p-4 border-b border-surface-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Components</h2>
        <SearchInput />
      </div>

      <div className="p-4 border-b border-surface-200">
        <CategoryFilter />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {!isLoading && !error && filteredComponents.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">
            No components found
          </p>
        )}

        {!isLoading && !error && filteredComponents.length > 0 && (
          <div className="space-y-2">
            {filteredComponents.map((definition) => (
              <ComponentCard key={definition.type} definition={definition} />
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-surface-200 bg-surface-50">
        <p className="text-xs text-gray-500 text-center">
          Drag components to the canvas
        </p>
      </div>
    </aside>
  );
}
