import type { Sound } from "@lifepilot/shared";

export const SOUNDS: { id: Exclude<Sound, "none">; name: string; description: string }[] = [
  { id: "daily_chime", name: "LifePilot Daily Chime", description: "Calm two-note chime for everyday reminders." },
  { id: "priority_alert", name: "LifePilot Priority Alert", description: "Brighter rising triplet for high-priority items." },
  { id: "deadline_alert", name: "LifePilot Deadline Alert", description: "Distinct motif for things that are due now." },
];

const cache = new Map<string, HTMLAudioElement>();

/**
 * Plays one of the bundled sounds. Browsers block audio until the user has interacted with the
 * page; in that case this resolves to false and nothing is played (we never try to work around it).
 */
export async function playSound(sound: Sound): Promise<boolean> {
  if (sound === "none") return false;
  let el = cache.get(sound);
  if (!el) {
    el = new Audio(`/sounds/${sound}.wav`);
    el.preload = "auto";
    cache.set(sound, el);
  }
  try {
    el.currentTime = 0;
    await el.play();
    return true;
  } catch {
    return false;
  }
}
