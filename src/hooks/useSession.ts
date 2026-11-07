// src/hooks/useSession.ts
//
// Session + profile + role. Client-only (used under the _authenticated gate).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "admin" | "driver";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  vehicle: string | null;
  phone: string | null;
  speed_limit_kmh: number;
}

interface SessionState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ loading: true, session: null, user: null, profile: null, role: null });

  const loadProfile = useCallback(async (userId: string) => {
    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const role = roles?.some((r) => r.role === "admin") ? "admin" : roles?.length ? "driver" : null;
    let p = (profile as Profile) ?? null;
    // Copy vehicle/phone entered at signup into the profile on first sign-in.
    if (p && (!p.vehicle || !p.phone)) {
      const { data: u } = await supabase.auth.getUser();
      const meta = (u.user?.user_metadata ?? {}) as Record<string, string | undefined>;
      const patch: { vehicle?: string; phone?: string } = {};
      if (!p.vehicle && meta["vehicle"]) patch.vehicle = meta["vehicle"];
      if (!p.phone && meta["phone"]) patch.phone = meta["phone"];
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
        if (!error) p = { ...p, ...patch };
      }
    }
    setState((s) => ({ ...s, profile: p, role }));
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(async ({ data }) => {
      if (!mounted) return;
      const user = data.user ?? null;
      setState((s) => ({ ...s, user, session: user ? s.session : null, loading: false }));
      if (user) await loadProfile(user.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (!mounted) return;
      const user = session?.user ?? null;
      setState((s) => ({ ...s, session, user, profile: user ? s.profile : null, role: user ? s.role : null, loading: false }));
      if (user) void loadProfile(user.id);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (state.user) await loadProfile(state.user.id);
  }, [state.user, loadProfile]);

  return { ...state, refreshProfile };
}
