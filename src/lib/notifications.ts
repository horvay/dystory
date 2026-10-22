// Chrome notifications: this browser's Web Push subscription, and clicks on
// notifications routed into the app. The worker side is worker/notify.ts; the
// service worker is public/sw.js.
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const supported =
  !!PUBLIC_KEY && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const registration = supported ? navigator.serviceWorker.register("/sw.js") : null;

function urlBase64ToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export type NotifyState = "unsupported" | "blocked" | "off" | "on" | "loading";

/** Whether this browser gets notifications, and a switch for it. */
export function useNotifications(userId: Id<"users">) {
  const [endpoint, setEndpoint] = useState<string | null | undefined>(supported ? undefined : null);
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  const [busy, setBusy] = useState(false);
  const known = useQuery(api.push.isSubscribed, endpoint ? { endpoint } : "skip");
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);

  useEffect(() => {
    if (!registration) return;
    void registration
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEndpoint(sub?.endpoint ?? null))
      .catch(() => setEndpoint(null));
  }, []);

  // A subscription the browser kept but the app lost (or that belongs to
  // someone who switched users here) gets re-registered under this person.
  useEffect(() => {
    if (!endpoint || known !== false || !registration) return;
    void registration
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => sub && subscribe({ userId, ...keysOf(sub) }));
  }, [endpoint, known, subscribe, userId]);

  const state: NotifyState = !supported
    ? "unsupported"
    : permission === "denied"
      ? "blocked"
      : busy || endpoint === undefined
        ? "loading"
        : endpoint
          ? "on"
          : "off";

  async function toggle() {
    if (!registration || busy) return;
    setBusy(true);
    try {
      const reg = await registration;
      const current = await reg.pushManager.getSubscription();
      if (current) {
        await unsubscribe({ endpoint: current.endpoint });
        await current.unsubscribe();
        setEndpoint(null);
        return;
      }
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(PUBLIC_KEY!),
      });
      await subscribe({ userId, ...keysOf(sub) });
      setEndpoint(sub.endpoint);
    } finally {
      setBusy(false);
    }
  }

  return { state, toggle };
}

function keysOf(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys!.p256dh!, auth: json.keys!.auth! };
}

/** Clicking a notification while the app is open routes there without a reload. */
export function useNotificationClicks() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!supported) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "navigate") return;
      const url = new URL(e.data.url, location.origin);
      setLocation(url.pathname + url.search);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [setLocation]);
}
