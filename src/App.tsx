import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Onboarding } from "./components/Onboarding";
import { Shell } from "./components/Shell";
import { MeProvider, useStoredUserId } from "./lib/identity";

export function App() {
  const [userId, setUserId] = useStoredUserId();
  const user = useQuery(api.users.get, userId ? { userId } : "skip");

  if (userId && user === undefined) {
    return <div className="grid h-full place-items-center text-muted">Loading…</div>;
  }
  if (!userId || !user) return <Onboarding onDone={setUserId} />;
  return (
    <MeProvider me={user}>
      <Shell onSwitchUser={() => setUserId(null)} />
    </MeProvider>
  );
}
