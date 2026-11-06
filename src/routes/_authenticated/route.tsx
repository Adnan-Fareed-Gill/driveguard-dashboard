import { createFileRoute, Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Pathless layout protecting every child route. Rendered client-side only:
// the session lives in browser storage, so there is no SSR gate here.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (session.loading) return;
    if (!session.user) {
      navigate({ to: "/auth", search: { redirect: router.state.location.href } });
    } else {
      setChecked(true);
    }
  }, [session.loading, session.user, navigate, router]);

  if (session.loading || !checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="pulse-dot text-primary" />
          <span className="text-sm">Checking your session…</span>
        </div>
      </div>
    );
  }

  const initials = (session.profile?.full_name || session.user?.email || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabaseSignOut();
    navigate({ to: "/auth", replace: true });
  }

  async function supabaseSignOut() {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signOut();
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/monitor" className="flex items-center gap-2">
            <span className="pulse-dot text-primary" aria-hidden />
            <span className="font-display text-base font-bold tracking-tight">Drowsy Guard</span>
          </Link>

          <nav className="flex items-center gap-1">
            <NavLink to="/monitor">Monitor</NavLink>
            <NavLink to="/trips">My Trips</NavLink>
            {session.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full outline-none ring-ring focus-visible:ring-2" aria-label="Account menu">
                <Avatar className="h-9 w-9 border border-border">
                  <AvatarFallback className="bg-secondary text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate text-sm">{session.profile?.full_name || session.user?.email}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">{session.user?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/profile">Profile & settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        Drowsy Guard — drive alert, arrive safe.
      </footer>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
      activeProps={{ className: "active" }}
    >
      {children}
    </Link>
  );
}
