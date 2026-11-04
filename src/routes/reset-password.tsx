import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — DriverGuard" },
      { name: "description", content: "Choose a new password for your DriverGuard account." },
      { property: "og:title", content: "Set a new password — DriverGuard" },
      { property: "og:description", content: "Choose a new password for your DriverGuard account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [isRecovery, setIsRecovery] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    setIsRecovery(params.get("type") === "recovery");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. You're signed in.");
      await navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the password.");
    } finally {
      setBusy(false);
    }
  }

  if (isRecovery === null) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-md p-8">
        <h1 className="font-display text-2xl font-bold">Set a new password</h1>
        {isRecovery ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a new password for your account.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            This link isn't a password reset link.{" "}
            <Link to="/forgot-password" className="text-foreground underline">
              Request a new one
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
