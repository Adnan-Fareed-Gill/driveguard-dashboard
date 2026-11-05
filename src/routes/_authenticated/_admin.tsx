import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useSession } from "@/hooks/useSession";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

// Pathless layout guarding the admin area. The role itself is verified again
// server-side inside every admin server function.
export const Route = createFileRoute("/_authenticated/_admin")({
  ssr: false,
  component: AdminLayout,
});

function AdminLayout() {
  const session = useSession();

  if (session.loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <span className="pulse-dot mr-3 text-primary" />
        Checking your access…
      </div>
    );
  }

  if (session.role !== "admin") {
    return (
      <div className="panel mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-xl font-bold">Admin access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account ({session.user?.email}) is a driver account. The admin dashboard is only
          visible to fleet administrators.
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link to="/monitor">Back to live monitor</Link>
        </Button>
      </div>
    );
  }

  return <Outlet />;
}
