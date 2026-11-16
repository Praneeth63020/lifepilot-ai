import clsx from "clsx";
import { Link } from "react-router-dom";
import type { EmailRequestDTO } from "@lifepilot/shared";
import { buttonClass } from "./ui";

const linkCls = "font-medium text-accent-strong underline-offset-2 hover:underline";

/** Path and query of an emailed link, so it opens inside the app on whatever host is serving it. */
function inAppPath(link: string) {
  const u = new URL(link, window.location.origin);
  return u.pathname + u.search;
}

/**
 * Shown only by a local development server with no email set up (the API includes `devMail`
 * only then): the email was written to the API log instead of being sent, so the link is shown here.
 */
export function DevMailNote({ devMail, action }: { devMail: NonNullable<EmailRequestDTO["devMail"]>; action: string }) {
  return (
    <div role="status" className="rounded-2xl border border-accent/60 bg-accent-soft p-4 text-sm leading-relaxed">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">Local development</p>
      {devMail.link ? (
        <>
          <p className="mt-1">Email sending isn't set up on this server (<code className="text-xs">SMTP_URL</code> is empty), so no email was sent. Use your link here instead:</p>
          <Link to={inAppPath(devMail.link)} className={clsx(buttonClass({ variant: "primary" }), "mt-3 w-full")}>{action}</Link>
        </>
      ) : (
        <p className="mt-1">No account on this local server uses that email. Check the spelling, or <Link className={linkCls} to="/register">create an account</Link>.</p>
      )}
    </div>
  );
}
