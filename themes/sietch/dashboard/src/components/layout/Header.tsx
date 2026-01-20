/**
 * Header Component
 *
 * Sprint 116: Dashboard Shell
 * Sprint 144: Dashboard Login Integration
 *
 * Top navigation header with user info and actions.
 * Supports both Discord OAuth and local authentication.
 */

import { LogOut, Settings, User as UserIcon, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore, isDiscordUser, isLocalUser, type Guild } from '@/stores/authStore';
import { getAvatarUrl } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const { user, logout, isLoggingOut } = useAuth();
  const selectedGuildId = useAuthStore((state) => state.selectedGuildId);

  // Get selected guild for Discord users only
  const selectedGuild: Guild | undefined = isDiscordUser(user)
    ? user.adminGuilds.find((g: Guild) => g.id === selectedGuildId)
    : undefined;

  // Get user subtitle based on auth type
  const getUserSubtitle = () => {
    if (isDiscordUser(user)) {
      return `${user.adminGuilds.length} server${user.adminGuilds.length !== 1 ? 's' : ''}`;
    }
    if (isLocalUser(user)) {
      return user.roles.join(', ');
    }
    return '';
  };

  // Get avatar URL for Discord users, null for local users
  const avatarUrl = isDiscordUser(user) ? getAvatarUrl(user.id, user.avatar) : undefined;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="flex items-center space-x-4">
          <a href="/" className="flex items-center space-x-2">
            <span className="font-bold text-xl">Stilgar</span>
          </a>
          {selectedGuild && (
            <>
              <span className="text-muted-foreground">/</span>
              <span className="font-medium">{selectedGuild.name}</span>
            </>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end space-x-4">
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    {avatarUrl ? (
                      <AvatarImage src={avatarUrl} alt={user.username} />
                    ) : null}
                    <AvatarFallback>
                      {isLocalUser(user) ? (
                        <Shield className="h-4 w-4" />
                      ) : (
                        user.username.slice(0, 2).toUpperCase()
                      )}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.username}</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {getUserSubtitle()}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <UserIcon className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()} disabled={isLoggingOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{isLoggingOut ? 'Logging out...' : 'Log out'}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
