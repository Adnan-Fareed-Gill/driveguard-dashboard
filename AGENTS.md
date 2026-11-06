<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# AGENTS.md — project decisions

- Web rebuild of the Expo/React Native "Drowsy Guard" app (github.com/Mursaleen-4/Driver-Drowsiness-App). This project builds web apps only; the TFLite model runs in the browser via @tensorflow/tfjs + @tensorflow/tfjs-tflite (dynamic imports only, so SSR never touches TF).
- Trained model lives at `public/models/drowsiness.tflite` (served statically, 320×320×3 in, [1,11,2100] out, 7 classes); decoder/scorer logic is ported 1:1 from the mobile repo in `src/lib/drowsiness/` — keep thresholds identical (drowsy 1s / critical 3s / safe 1.5s).
- All trip writes go through `src/lib/trips/outbox.ts` (localStorage queue flushed on enqueue/online/30s). Offline-created trips use a local UUID that is remapped to the real row id on flush via the `driverguard:trip-id-resolved` event — don't bypass the outbox when adding trip writes.
- Admin reads are server functions in `src/server/admin.ts` that verify the caller's admin role via `has_role` RPC before any cross-driver query; RLS policies mirror this. Roles live only in `public.user_roles`.
- Admin account is granted automatically by the `handle_new_user` signup trigger (admin email configured in project memory); never store roles in profiles.
- Live driver status = `trips.current_*` columns updated by a 10s ping through the outbox; admin overview polls every 15s and treats a 3-minute ping window as "live".
- Leaflet and TF are browser-only: dynamic `import()` inside effects, `window.L` set in LiveMap; never static-import them from an SSR-reachable module.
- Weather comes from Open-Meteo (no key) and alerts are pure rules in `src/lib/weather.ts` (unit-tested); reverse geocoding via BigDataCloud free client endpoint.
