/**
 * Sidebar Component
 *
 * Sprint 116: Dashboard Shell
 *
 * Navigation sidebar for dashboard pages.
 */

import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Users,
  Shield,
  History,
  Server,
  Layers,
  ToggleLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  {
    title: 'Overview',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Tiers',
    href: '/dashboard/tiers',
    icon: Layers,
  },
  {
    title: 'Thresholds',
    href: '/dashboard/thresholds',
    icon: Settings,
  },
  {
    title: 'Feature Gates',
    href: '/dashboard/features',
    icon: ToggleLeft,
  },
  {
    title: 'Role Mappings',
    href: '/dashboard/roles',
    icon: Shield,
  },
  {
    title: 'Members',
    href: '/dashboard/members',
    icon: Users,
  },
  {
    title: 'History',
    href: '/dashboard/history',
    icon: History,
  },
];

export function Sidebar() {
  const location = useLocation();
  const selectedGuildId = useAuthStore((state) => state.selectedGuildId);

  if (!selectedGuildId) {
    return null;
  }

  return (
    <aside className="fixed left-0 top-14 z-30 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r bg-background md:block">
      <div className="flex h-full flex-col">
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-4">
          <Link
            to="/servers"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Server className="h-4 w-4" />
            Switch Server
          </Link>
        </div>
      </div>
    </aside>
  );
}
