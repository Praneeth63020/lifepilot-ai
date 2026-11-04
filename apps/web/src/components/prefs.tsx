import clsx from "clsx";
import { Volume2 } from "lucide-react";
import type { Sound } from "@lifepilot/shared";
import { hhmm, parseHHMM } from "../lib/format";
import { SOUNDS, playSound } from "../lib/sounds";
import { Button, Input, Select } from "./ui";

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles"];
  }
})();

export function TimezoneSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const list = ZONES.includes(value) ? ZONES : [value, ...ZONES];
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </Select>
  );
}

export function TimeOfDay({ value, onChange, id }: { value: number; onChange: (min: number) => void; id?: string }) {
  return <Input id={id} type="time" value={hhmm(value)} onChange={(e) => e.target.value && onChange(parseHHMM(e.target.value))} />;
}

export function SoundPicker({ value, onChange }: { value: Sound; onChange: (s: Sound) => void }) {
  return (
    <div role="radiogroup" aria-label="Notification sound" className="flex flex-col gap-2">
      {[...SOUNDS, { id: "none" as const, name: "No sound", description: "Silent in-app notifications." }].map((s) => (
        <div
          key={s.id}
          className={clsx("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", value === s.id ? "border-accent bg-accent-soft" : "border-line")}
        >
          <label className="flex flex-1 cursor-pointer items-center gap-3">
            <input type="radio" name="sound" value={s.id} checked={value === s.id} onChange={() => onChange(s.id)} className="accent-[var(--lp-accent)]" />
            <span>
              <span className="block text-sm font-medium">{s.name}</span>
              <span className="block text-xs text-muted">{s.description}</span>
            </span>
          </label>
          {s.id !== "none" && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void playSound(s.id)} aria-label={`Preview ${s.name}`}>
              <Volume2 className="size-4" /> Preview
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
