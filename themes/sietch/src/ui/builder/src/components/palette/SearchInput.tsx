import { Search, X } from 'lucide-react';
import { useComponentStore } from '@stores';

export function SearchInput() {
  const searchQuery = useComponentStore((s) => s.searchQuery);
  const setSearchQuery = useComponentStore((s) => s.setSearchQuery);

  return (
    <div className="relative">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        size={16}
      />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search components..."
        className="w-full pl-9 pr-8 py-2 text-sm border border-surface-200 rounded-lg
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
          placeholder:text-gray-400"
      />
      {searchQuery && (
        <button
          onClick={() => setSearchQuery('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
