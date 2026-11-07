import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { mode?: "signin" | "signup"; redirect?: string; portal?: "driver" | "admin" } => {
    const result: { mode?: "signin" | "signup"; redirect?: string; portal?: "driver" | "admin" } = {};
    const portal = search["portal"];
    if (portal === "admin" || portal === "driver") result.portal = portal;
    const mode = search["mode"];
    if (mode === "signup" || mode === "signin") result.mode = mode;
    const redirect = search["redirect"];
    if (typeof redirect === "string" && redirect.length > 0) result.redirect = redirect;
    return result;
  },
  head: () => ({
    meta: [
      { title: "Sign in — Drowsy Guard" },
      { name: "description", content: "Sign in to Drowsy Guard as a driver or fleet admin." },
      { property: "og:title", content: "Sign in — Drowsy Guard" },
      { property: "og:description", content: "Sign in to Drowsy Guard as a driver or fleet admin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

// UX hint only — the signup trigger is what actually grants the admin role.
const ADMIN_EMAIL = "adnanfareed516@gmail.com";

function safeRedirect(raw: string | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

async function fetchRole(userId: string): Promise<"admin" | "driver"> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return data?.some((r) => r.role === "admin") ? "admin" : "driver";
}

function AuthPage() {
  const { mode, redirect, portal: portalParam } = Route.useSearch();
  const portal = portalParam ?? "driver";
  const isAdminPortal = portal === "admin";
  const navigate = useNavigate();
  const router = useRouter();
  const [isSignup, setIsSignup] = useState(mode === "signup");  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  const requested = safeRedirect(redirect);
  const home = isAdminPortal ? "/admin" : "/monitor";

  async function enterPortal(userId: string) {
    const role = await fetchRole(userId);
    if (role !== portal) {
      await supabase.auth.signOut();
      throw new Error(
        role === "admin"
          ? "This account is a Fleet Admin account. Please use the Admin portal."
          : "This account is a Fleet Driver account. Please use the Driver portal.",
      );
    }
    await router.invalidate();
    const allowed = requested && (role === "admin" ? requested.startsWith("/admin") : !requested.startsWith("/admin"));
    await navigate({ to: allowed ? requested : home });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!isSignup) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await enterPortal(data.user.id);
      } else {
        const isAdminEmail = email.trim().toLowerCase() === ADMIN_EMAIL;
        if (isAdminPortal && !isAdminEmail)
          throw new Error("Admin accounts can only be created with the authorised fleet admin email.");
        if (!isAdminPortal && isAdminEmail)
          throw new Error("This email is reserved for the Fleet Admin. Please use the Admin portal.");
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth?portal=${portal}`,
            data: { full_name: fullName, vehicle, phone },
          },
        });
        if (error) throw error;
        if (data.session && data.user) {
          await enterPortal(data.user.id);
        } else {
          setAwaitingConfirm(true);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (awaitingConfirm) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="panel max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
            <span className="pulse-dot text-primary" />
          </div>
          <h1 className="font-display text-xl font-bold">Check your email</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            We sent a confirmation link to <span className="text-foreground">{email}</span>. Open it
            to activate your account, then sign in.
          </p>
          <Button variant="outline" className="mt-6" asChild>
            <Link to="/auth" search={{ portal }}>Back to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="pulse-dot text-primary" aria-hidden />
          <span className="font-display text-lg font-bold tracking-tight">Drowsy Guard</span>
        </Link>
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary/40 p-1">
          {(["driver", "admin"] as const).map((p) => (
            <Link
              key={p}
              to="/auth"
              search={{ portal: p, mode: isSignup ? "signup" : "signin" }}
              className={`rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${portal === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {p === "driver" ? "Fleet Driver" : "Fleet Admin"}
            </Link>
          ))}
        </div>
        <div className="panel p-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            {isAdminPortal ? "Admin portal" : "Driver portal"}
          </p>
          <h1 className="font-display text-2xl font-bold">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdminPortal
              ? isSignup
                ? "Register the authorised fleet admin account."
                : "Sign in to the fleet control room."
              : isSignup
                ? "Driver accounts start monitoring right away."
                : "Sign in to your driver dashboard."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {isSignup && isAdminPortal && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Fleet manager" />
              </div>
            )}
            {isSignup && !isAdminPortal && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ali Raza"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="vehicle">Vehicle</Label>
                    <Input
                      id="vehicle"
                      value={vehicle}
                      onChange={(e) => setVehicle(e.target.value)}
                      placeholder="Honda City · ABC-123"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+92 300 0000000"
                    />
                  </div>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setIsSignup(!isSignup)}
            >
              {isSignup ? "Already have an account? Sign in" : "New here? Create an account"}
            </button>
            <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
