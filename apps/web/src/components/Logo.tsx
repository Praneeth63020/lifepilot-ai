import { Link } from "react-router-dom";

export function Logo({ to = "/app" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-semibold tracking-tight" aria-label="LifePilot AI home">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-[#1e1b4b] dark:fill-[#2b2870]" />
        <path d="M9 22 L16 8 L23 22 L16 18 Z" fill="#a5b4fc" />
      </svg>
      <span>
        LifePilot <span className="text-accent">AI</span>
      </span>
    </Link>
  );
}
