import { api } from "../api";

export type PushSupport = "unsupported" | "insecure" | "denied" | "default" | "granted";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return Notification.permission as PushSupport;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask for permission (only from a user gesture) and register this browser for web push. */
export async function enablePush(vapidPublicKey: string): Promise<{ ok: boolean; reason?: string }> {
  const support = pushSupport();
  if (support === "unsupported") return { ok: false, reason: "This browser doesn't support web push. On iPhone/iPad, add LifePilot to your Home Screen first." };
  if (support === "insecure") return { ok: false, reason: "Push requires HTTPS (or localhost)." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "Notification permission was not granted. You can change this in your browser's site settings." };
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  const json = sub.toJSON();
  await api.post("/push/subscriptions", { endpoint: json.endpoint, keys: json.keys });
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.del("/push/subscriptions", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
}
