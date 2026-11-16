/**
 * LifePilot AI transactional emails: one shared layout, an HTML and a plain-text version of each.
 *
 * Email clients ignore stylesheets and most modern CSS, so the HTML uses tables and inline styles,
 * a single centred column (max 560px, full width on phones), and a "bulletproof" button that still
 * works with images and CSS turned off. The link is always repeated as text under the button.
 * Every value placed into HTML is escaped.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

interface Common {
  /** Public site address (WEB_URL), used for the wordmark link. */
  webUrl: string;
  /** Shown in the footer when set; replies go there too (Reply-To). */
  supportEmail: string | null;
}

const BRAND = {
  brown: "#3B2418",
  cream: "#F2E8DA",
  blue: "#8EC5FF",
  text: "#3B2418",
  muted: "#6B5444",
  line: "#E6D7C3",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface Layout extends Common {
  subject: string;
  /** Hidden preview text that inbox lists show after the subject. */
  preheader: string;
  heading: string;
  /** Paragraphs before the button (plain text, escaped here). */
  intro: string[];
  button?: { label: string; url: string };
  /** Paragraphs after the button. */
  outro: string[];
  /** Short security note in a tinted box. */
  notice?: string;
}

function render(l: Layout): EmailContent {
  const p = (s: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${BRAND.text};">${escapeHtml(s)}</p>`;
  const support = l.supportEmail
    ? `Questions? Reply to this email or write to <a href="mailto:${escapeHtml(l.supportEmail)}" style="color:${BRAND.brown};font-weight:600;">${escapeHtml(l.supportEmail)}</a>.`
    : "";
  const button = l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
        <tr><td align="center" bgcolor="${BRAND.blue}" style="border-radius:10px;background:${BRAND.blue};">
          <a href="${escapeHtml(l.button.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${BRAND.font};font-size:16px;font-weight:700;color:${BRAND.brown};text-decoration:none;border-radius:10px;border:1px solid #6FAEEB;">${escapeHtml(l.button.label)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:${BRAND.muted};">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(l.button.url)}" style="color:${BRAND.brown};word-break:break-all;">${escapeHtml(l.button.url)}</a></p>`
    : "";
  const notice = l.notice
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td style="background:#FBF6EF;border:1px solid ${BRAND.line};border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.55;color:${BRAND.muted};">${escapeHtml(l.notice)}</td></tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(l.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F7F3EE;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F3EE;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${BRAND.font};">
      <tr><td style="padding:0 4px 20px;">
        <a href="${escapeHtml(l.webUrl)}" target="_blank" style="text-decoration:none;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="32" height="32" align="center" valign="middle" bgcolor="${BRAND.brown}" style="width:32px;height:32px;border-radius:9px;background:${BRAND.brown};color:${BRAND.blue};font-size:15px;line-height:32px;">&#9650;</td>
            <td style="padding-left:10px;font-family:${BRAND.font};font-size:18px;font-weight:700;color:${BRAND.brown};letter-spacing:-0.01em;">LifePilot <span style="color:#1F5E99;">AI</span></td>
          </tr></table>
        </a>
      </td></tr>
      <tr><td style="background:#FFFFFF;border:1px solid ${BRAND.line};border-radius:16px;padding:36px 32px 28px;">
        <h1 style="margin:0 0 18px;font-family:${BRAND.font};font-size:24px;line-height:1.3;font-weight:700;color:${BRAND.brown};letter-spacing:-0.01em;">${escapeHtml(l.heading)}</h1>
        ${l.intro.map(p).join("\n        ")}
        ${button}
        ${notice}
        ${l.outro.map(p).join("\n        ")}
        <p style="margin:8px 0 0;font-size:16px;line-height:1.6;color:${BRAND.text};">LifePilot AI Support</p>
      </td></tr>
      <tr><td style="padding:20px 8px 0;font-family:${BRAND.font};font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center;">
        ${support ? `${support}<br>` : ""}You're receiving this because of activity on your LifePilot AI account. We never ask for your password by email.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    l.heading,
    "",
    ...l.intro.flatMap((s) => [s, ""]),
    ...(l.button ? [`${l.button.label}: ${l.button.url}`, ""] : []),
    ...(l.notice ? [l.notice, ""] : []),
    ...l.outro.flatMap((s) => [s, ""]),
    "LifePilot AI Support",
    ...(l.supportEmail ? ["", `Questions? Reply to this email or write to ${l.supportEmail}.`] : []),
    "",
    "We never ask for your password by email.",
  ].join("\n");

  return { subject: l.subject, html, text };
}

export function verificationEmail(p: Common & { link: string; expiresHours: number }): EmailContent {
  return render({
    ...p,
    subject: "Verify your LifePilot AI email address",
    preheader: "Confirm your email address to finish setting up LifePilot AI.",
    heading: "Confirm your email address",
    intro: ["Hello,", "Thanks for creating a LifePilot AI account. Please confirm that this is your email address."],
    button: { label: "Verify email", url: p.link },
    notice: `This link is valid for ${p.expiresHours} hours and can only be used once.`,
    outro: ["If you didn't create a LifePilot AI account, you can safely ignore this email."],
  });
}

export function passwordResetEmail(p: Common & { link: string; expiresMinutes: number }): EmailContent {
  return render({
    ...p,
    subject: "Reset your LifePilot AI password",
    preheader: "Use this link to choose a new password.",
    heading: "Reset your password",
    intro: ["Hello,", "We received a request to reset your LifePilot AI account password.", "Click the button below to choose a new password."],
    button: { label: "Reset password", url: p.link },
    notice: `This link is valid for ${p.expiresMinutes} minutes and can only be used once. Requesting a new link doesn't cancel this one, but using any link cancels all the others.`,
    outro: ["If you didn't request this change, you can safely ignore this email. Your password stays the same."],
  });
}

export function passwordChangedEmail(p: Common & { when: string; resetUrl: string }): EmailContent {
  return render({
    ...p,
    subject: "Your LifePilot AI password was changed",
    preheader: "If this wasn't you, reset your password now.",
    heading: "Your password was changed",
    intro: [
      "Hello,",
      `The password for your LifePilot AI account was changed on ${p.when}.`,
      "For your security, every device that was signed in has been signed out.",
      "If you made this change, there's nothing else to do. If you didn't, reset your password right away and contact support.",
    ],
    button: { label: "Reset password", url: p.resetUrl },
    outro: [],
  });
}

/** Sent only by `pnpm mail:check --send-to <address>`, to confirm delivery end to end. */
export function smtpTestEmail(p: Common): EmailContent {
  return render({
    ...p,
    subject: "LifePilot AI test email",
    preheader: "Your LifePilot AI email setup works.",
    heading: "Email delivery works",
    intro: ["Hello,", "This is a test message from your LifePilot AI server. If you can read it, verification and password-reset emails will reach your customers."],
    notice: "Check that it arrived in the inbox (not spam), and that replying goes to your support address.",
    outro: [],
  });
}
