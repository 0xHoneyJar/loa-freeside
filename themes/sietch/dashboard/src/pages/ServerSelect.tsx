/**
 * Server Select Page
 *
 * Sprint 116: Dashboard Shell
 *
 * Lists servers where the user is an admin for selection.
 */

import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { getGuildIconUrl } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Header } from '@/components/layout/Header';

export function ServerSelectPage() {
  const navigate = useNavigate();
  const { user, isLoading, isAuthenticated } = useAuth();
  const selectGuild = useAuthStore((state) => state.selectGuild);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const handleSelectServer = (guildId: string) => {
    selectGuild(guildId);
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold">Select a Server</h1>
            <p className="mt-2 text-muted-foreground">
              Choose a server to configure. You can only manage servers where you have admin permissions.
            </p>
          </div>

          {user?.adminGuilds.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">
                  You don't have admin permissions in any servers with Stilgar installed.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {user?.adminGuilds.map((guild) => (
                <Card
                  key={guild.id}
                  className="cursor-pointer transition-colors hover:bg-accent"
                  onClick={() => handleSelectServer(guild.id)}
                >
                  <CardHeader className="flex flex-row items-center gap-4 space-y-0">
                    <Avatar className="h-12 w-12">
                      {guild.icon ? (
                        <AvatarImage src={getGuildIconUrl(guild.id, guild.icon, 96)} alt={guild.name} />
                      ) : null}
                      <AvatarFallback className="text-lg">
                        {guild.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{guild.name}</CardTitle>
                      <CardDescription>Click to configure this server</CardDescription>
                    </div>
                    <svg
                      className="h-5 w-5 text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
