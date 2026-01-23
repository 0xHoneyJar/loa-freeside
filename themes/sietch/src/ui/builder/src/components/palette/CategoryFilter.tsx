import { clsx } from 'clsx';
import { useComponentStore, selectCategories } from '@stores';

const categoryLabels: Record<string, string> = {
  web3: 'Web3',
  content: 'Content',
  layout: 'Layout',
  social: 'Social',
};

const categoryColors: Record<string, { active: string; inactive: string }> = {
  web3: {
    active: 'bg-purple-500 text-white',
    inactive: 'bg-purple-50 text-purple-700 hover:bg-purple-100',
  },
  content: {
    active: 'bg-blue-500 text-white',
    inactive: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
  },
  layout: {
    active: 'bg-green-500 text-white',
    inactive: 'bg-green-50 text-green-700 hover:bg-green-100',
  },
  social: {
    active: 'bg-orange-500 text-white',
    inactive: 'bg-orange-50 text-orange-700 hover:bg-orange-100',
  },
};

export function CategoryFilter() {
  const categories = useComponentStore(selectCategories);
  const activeCategory = useComponentStore((s) => s.activeCategory);
  const setActiveCategory = useComponentStore((s) => s.setActiveCategory);

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => setActiveCategory(null)}
        className={clsx(
          'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
          activeCategory === null
            ? 'bg-gray-700 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        )}
      >
        All
      </button>
      {categories.map((category) => {
        const colors = categoryColors[category] || {
          active: 'bg-gray-700 text-white',
          inactive: 'bg-gray-100 text-gray-600 hover:bg-gray-200',
        };
        const isActive = activeCategory === category;

        return (
          <button
            key={category}
            onClick={() => setActiveCategory(isActive ? null : category)}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
              isActive ? colors.active : colors.inactive
            )}
          >
            {categoryLabels[category] || category}
          </button>
        );
      })}
    </div>
  );
}
