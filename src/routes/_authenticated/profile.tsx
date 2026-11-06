import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Profile & settings — Drowsy Guard" },
      { name: "description", content: "Your driver profile and monitoring settings." },
      { property: "og:title", content: "Profile & settings — Drowsy Guard" },
      { property: "og:description", content: "Your driver profile and monitoring settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const session = useSession();
  const [fullName, setFullName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [phone, setPhone] = useState("");
  const [speedLimit, setSpeedLimit] = useState("80");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = session.profile;
    if (p) {
      setFullName(p.full_name ?? "");
      setVehicle(p.vehicle ?? "");
      setPhone(p.phone ?? "");
      setSpeedLimit(String(p.speed_limit_kmh ?? 80));
    }
  }, [session.profile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!session.user) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim() || null,
          vehicle: vehicle.trim() || null,
          phone: phone.trim() || null,
          speed_limit_kmh: Math.max(20, Math.min(200, Number(speedLimit) || 80)),
        })
        .eq("id", session.user.id);
      if (error) throw error;
      await session.refreshProfile();
      toast.success("Profile saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Profile & settings</h1>
        <p className="text-sm text-muted-foreground">Admins see this information next to your live location.</p>
      </div>

      <div className="panel flex flex-wrap items-center gap-3 p-4 text-sm">
        <Badge variant={session.role === "admin" ? "default" : "secondary"}>
          {session.role === "admin" ? "Admin" : "Driver"}
        </Badge>
        <span className="text-muted-foreground">{session.user?.email}</span>
      </div>

      <form onSubmit={handleSave} className="panel space-y-5 p-6">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ali Raza" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vehicle">Vehicle</Label>
            <Input id="vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Honda City · ABC-123" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 0000000" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="speedLimit">Speed limit (km/h)</Label>
          <Input
            id="speedLimit"
            type="number"
            min={20}
            max={200}
            value={speedLimit}
            onChange={(e) => setSpeedLimit(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">The monitor warns and logs when you exceed this speed.</p>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </div>
  );
}
