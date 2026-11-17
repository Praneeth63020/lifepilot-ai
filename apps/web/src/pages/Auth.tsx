import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ArrowLeft, BellRing, CalendarCheck, CheckCircle2, Eye, EyeOff, Inbox, Info, ListChecks, Lock, MailCheck } from "lucide-react";
import { useSession } from "../session";
import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ApiError, api, errorMessage } from "../api";
import { Logo } from "../components/Logo";
import { Button, ErrorNote, Field, Input, buttonClass } from "../components/ui";
import { DevMailNote } from "../components/DevMailNote";
import { findPlan } from "../content/pricing";
import type { EmailRequestDTO } from "@lifepilot/shared";

const HIGHLIGHTS = [
  { icon: ListChecks, title: "Tasks and projects", body: "Priorities, subtasks, recurrence and progress in one list." },
  { icon: CalendarCheck, title: "A realistic daily plan", body: "Your top three priorities, fitted around your calendar and working hours." },
  { icon: Inbox, title: "A smart inbox you approve", body: "Deadlines found in email become tasks only when you say so." },
  { icon: BellRing, title: "Reminders that respect you", body: "Prep and due reminders, quiet hours, snooze and browser push." },
];

/** Charcoal brand panel beside the auth forms: real product highlights only. */
function BrandPanel() {
  return (
    <aside aria-label="About LifePilot" className="relative flex flex-col overflow-hidden rounded-[28px] bg-side p-7 text-side-ink sm:p-10 lg:h-full lg:p-12">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/15 blur-3xl" />
      <Logo to="/" onDark />
      <div aria-hidden className="relative mt-10 hidden max-w-sm rounded-2xl border border-side-line bg-side-2 p-4 lg:block">
        <p className="flex items-center justify-between text-xs text-side-muted">
          <span className="font-semibold text-side-ink">Today's plan</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">Sample data</span>
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {[
            { t: "9:00", n: "Finish project proposal", c: "bg-accent" },
            { t: "10:30", n: "Team stand-up", c: "bg-side-ink/70" },
            { t: "10:45", n: "Break", c: "bg-side-muted" },
            { t: "14:40", n: "Prepare: client call", c: "bg-accent/50" },
          ].map((r) => (
            <li key={r.t} className="flex items-center gap-3 text-sm">
              <span className="w-10 text-right font-mono text-[11px] text-side-muted">{r.t}</span>
              <span className={clsx("h-5 w-1 rounded-full", r.c)} />
              <span className="text-side-ink">{r.n}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative mt-10 lg:mt-auto">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Personal life manager</p>
        <p className="mt-3 max-w-md font-display text-3xl font-semibold leading-tight tracking-tight lg:text-[34px]">
          Plan the day you actually have.
        </p>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl border border-side-line bg-side-2 text-accent">
                <Icon className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-side-muted">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative mt-10 flex items-center gap-2 border-t border-side-line pt-6 text-xs text-side-muted lg:mt-12">
        <Lock className="size-3.5 shrink-0" aria-hidden /> Gmail and Google Calendar are optional and read-only. Export or delete your data any time.
      </p>
    </aside>
  );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] gap-3 sm:min-h-[calc(100vh-2rem)] sm:gap-4 lg:grid-cols-12">
        <div className="flex flex-col rounded-[28px] bg-surface px-5 py-6 shadow-card sm:px-10 sm:py-8 lg:col-span-7">
          <div className="flex items-center justify-between gap-4">
            <span className="lg:hidden">
              <Logo to="/" />
            </span>
            <Link to="/" className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink">
              <ArrowLeft className="size-4" aria-hidden /> Back to home
            </Link>
          </div>
          <main className="mx-auto flex w-full max-w-[420px] flex-1 2xl:max-w-[480px] flex-col justify-center py-10 sm:py-14">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-[34px]">{title}</h1>
            {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
            <div className="mt-8">{children}</div>
          </main>
          <p className="text-center text-xs text-muted">
            <Link to="/privacy" className="hover:text-ink hover:underline">Privacy policy</Link>
            <span aria-hidden className="mx-2">·</span>
            <Link to="/terms" className="hover:text-ink hover:underline">Terms of service</Link>
            <span aria-hidden className="mx-2">·</span>© {new Date().getFullYear()} LifePilot AI
          </p>
        </div>
        <div className="lg:col-span-5">
          <BrandPanel />
        </div>
      </div>
    </div>
  );
}

/** Password input with a show/hide toggle. A native <input> so react-hook-form's ref reaches it. */
const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput({ className, ...props }, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        {...props}
        type={show ? "text" : "password"}
        className={clsx(
          "h-11 w-full rounded-xl border border-line bg-surface px-3 pr-11 text-sm text-ink placeholder:text-muted/70 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent/30",
          className,
        )}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
      >
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
});

const linkCls = "font-medium text-accent-strong underline-offset-2 hover:underline";

const loginForm = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export function LoginPage() {
  const { startNewSession } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState<string | null>(null);
  const f = useForm<z.infer<typeof loginForm>>({ resolver: zodResolver(loginForm) });
  const submit = f.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post("/auth/login", v);
      await startNewSession();
      nav((loc.state as { from?: string } | null)?.from ?? "/app");
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  const pwError = f.formState.errors.password?.message;
  return (
    <AuthShell title="Welcome back" subtitle={<>New to LifePilot? <Link className={linkCls} to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {error && <ErrorNote error={new Error(error)} />}
        <Field label="Email" htmlFor="email" error={f.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" className="h-11" {...f.register("email")} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <PasswordInput id="password" autoComplete="current-password" aria-invalid={pwError ? true : undefined} {...f.register("password")} />
          {pwError && <p className="text-xs text-danger">{pwError}</p>}
          <Link
            to="/forgot-password"
            state={{ email: f.watch("email") ?? "" }}
            className="self-end text-sm font-medium text-accent-strong underline-offset-2 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" loading={f.formState.isSubmitting}>Sign in</Button>
      </form>
      <p className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">
        Don't have an account? <Link className={linkCls} to="/register">Get started</Link>
      </p>
    </AuthShell>
  );
}

const registerForm = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters"),
  terms: z.boolean().refine((v) => v, "Please agree to the Terms of service and Privacy policy to continue"),
});

export function RegisterPage() {
  const { startNewSession } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const plan = findPlan(params.get("plan"));
  const [error, setError] = useState<string | null>(null);
  const f = useForm<z.infer<typeof registerForm>>({ resolver: zodResolver(registerForm), defaultValues: { terms: false } });
  const submit = f.handleSubmit(async ({ terms: _agreed, ...v }) => {
    setError(null);
    try {
      await api.post("/auth/register", { ...v, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      await startNewSession();
      nav("/onboarding");
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  const termsError = f.formState.errors.terms?.message;
  return (
    <AuthShell title="Create your account" subtitle={<>Already have one? <Link className={linkCls} to="/login">Sign in</Link></>}>
      {plan && (
        <div role="note" className="mb-6 flex items-start gap-3 rounded-2xl border border-accent/50 bg-accent-soft px-4 py-3 text-sm text-ink">
          <Info className="mt-0.5 size-4 shrink-0 text-accent-strong" aria-hidden />
          <p>
            You chose the <strong className="font-semibold">{plan.name}</strong> plan. Billing isn't live yet — you won't be charged.
          </p>
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {error && <ErrorNote error={new Error(error)} />}
        <Field label="Name" htmlFor="name" error={f.formState.errors.name?.message}>
          <Input id="name" autoComplete="name" className="h-11" {...f.register("name")} />
        </Field>
        <Field label="Email" htmlFor="email" error={f.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" className="h-11" {...f.register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters." error={f.formState.errors.password?.message}>
          <PasswordInput id="password" autoComplete="new-password" {...f.register("password")} />
        </Field>
        <div>
          <div className="flex items-start gap-3">
            <input
              id="terms"
              type="checkbox"
              aria-invalid={termsError ? true : undefined}
              aria-describedby={termsError ? "terms-error" : undefined}
              className={clsx("mt-0.5 size-[18px] shrink-0 cursor-pointer rounded accent-accent", termsError && "outline outline-2 outline-danger/60")}
              {...f.register("terms")}
            />
            <label htmlFor="terms" className="text-sm leading-snug text-ink">
              I agree to the{" "}
              <Link to="/terms" target="_blank" rel="noopener" className={linkCls}>Terms of service</Link> and{" "}
              <Link to="/privacy" target="_blank" rel="noopener" className={linkCls}>Privacy policy</Link>
            </label>
          </div>
          {termsError && <p id="terms-error" className="mt-1.5 text-xs text-danger">{termsError}</p>}
        </div>
        <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" loading={f.formState.isSubmitting}>Create account</Button>
        <p className="text-center text-xs text-muted">No card needed. Connecting Gmail or Google Calendar is optional.</p>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const loc = useLocation();
  // Carries over what was typed on the sign-in page.
  const [email, setEmail] = useState(() => (loc.state as { email?: string } | null)?.email ?? "");
  const [sent, setSent] = useState<EmailRequestDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      setSent(await api.post<EmailRequestDTO>("/auth/request-password-reset", { email }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell
      title={sent ? "Check your email" : "Forgot your password?"}
      subtitle={sent ? undefined : "Enter the email address associated with your LifePilot account. We'll send you a link to reset your password."}
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          {error && <ErrorNote error={new Error(error)} />}
          {sent.devMail ? (
            <DevMailNote devMail={sent.devMail} action="Choose a new password" />
          ) : (
            <div role="status" className="flex gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-sm leading-relaxed">
              <MailCheck className="mt-0.5 size-5 shrink-0 text-accent-strong" aria-hidden />
              <div>
                <p>If an account exists with that email address, you will receive a password-reset link shortly. Please check your inbox.</p>
                <p className="mt-2 text-muted">The link works for 1 hour. Nothing after a few minutes? Check your spam or junk folder, then send it again.</p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} onClick={request}>Send again</Button>
            <Button variant="ghost" onClick={() => { setSent(null); setError(null); }}>Use a different email</Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void request();
          }}
        >
          {error && <ErrorNote error={new Error(error)} />}
          <Field label="Email address" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" className="h-11" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 flex items-center justify-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back to sign in
      </Link>
      <SupportHint />
    </AuthShell>
  );
}

/** A quiet "still stuck?" line with the support address, when one is configured. */
function SupportHint() {
  const { config } = useSession();
  if (!config?.supportEmail) return null;
  return (
    <p className="mt-4 text-center text-xs text-muted">
      Still stuck? <Link className={linkCls} to="/support">Contact support</Link>
    </p>
  );
}

const MIN_PASSWORD = 10;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [check, setCheck] = useState<"checking" | "valid" | "invalid">(token ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    api
      .post<{ valid: boolean }>("/auth/reset-password/check", { token })
      .then((r) => live && setCheck(r.valid ? "valid" : "invalid"))
      .catch(() => live && setCheck("invalid"));
    return () => {
      live = false;
    };
  }, [token]);

  const tooShort = password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = !tooShort && confirm === password;

  if (done) {
    return (
      <AuthShell title="Password updated">
        <div role="status" className="flex gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-sm leading-relaxed">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
          <p>Your password has been changed and every device has been signed out. Sign in with your new password to continue.</p>
        </div>
        <Link to="/login" className={clsx(buttonClass({ variant: "primary", size: "lg" }), "mt-5 w-full")}>Sign in</Link>
      </AuthShell>
    );
  }
  if (check !== "valid") {
    return (
      <AuthShell title={check === "checking" ? "Checking your link…" : "This link has expired"}>
        {check === "checking" ? (
          <p role="status" className="text-sm text-muted">One moment.</p>
        ) : (
          <>
            <div role="alert" className="flex gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm leading-relaxed">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
              <p>This password-reset link is invalid, has expired or has already been used. Reset links work for 1 hour, and only the newest one you use counts.</p>
            </div>
            <Link to="/forgot-password" className={clsx(buttonClass({ variant: "primary", size: "lg" }), "mt-5 w-full")}>Request a new link</Link>
            <Link to="/login" className="mt-4 flex items-center justify-center gap-1.5 text-sm text-muted hover:text-ink">
              <ArrowLeft className="size-4" aria-hidden /> Back to sign in
            </Link>
          </>
        )}
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle="Pick something you don't use anywhere else.">
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (!canSubmit) return;
          setBusy(true);
          setError(null);
          try {
            await api.post("/auth/reset-password", { token, password });
            setDone(true);
          } catch (err) {
            // The link expired or was used while the form was open.
            if (err instanceof ApiError && err.code === "invalid_token") setCheck("invalid");
            else setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorNote error={new Error(error)} />}
        <Field label="New password" htmlFor="pw" hint={touched && tooShort ? undefined : `At least ${MIN_PASSWORD} characters.`} error={touched && tooShort ? `Use at least ${MIN_PASSWORD} characters.` : undefined}>
          <PasswordInput id="pw" autoComplete="new-password" minLength={MIN_PASSWORD} required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={touched && tooShort ? true : undefined} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw2" error={mismatch || (touched && confirm !== password) ? "The passwords don't match." : undefined}>
          <PasswordInput id="pw2" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch ? true : undefined} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Update password</Button>
      </form>
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { me } = useSession();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const ran = useRef(false);
  const [resent, setResent] = useState<EmailRequestDTO | null>(null);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  useEffect(() => {
    if (ran.current) return; // tokens are single-use; don't double-submit in StrictMode
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setState("error");
      return;
    }
    api
      .post("/auth/verify-email", { token })
      .then(() => {
        setState("ok");
        qc.invalidateQueries({ queryKey: ["me"] });
      })
      .catch(() => setState("error"));
  }, [params, qc]);
  const resend = async () => {
    setResending(true);
    setResendError(null);
    try {
      setResent(await api.post<EmailRequestDTO>("/auth/resend-verification"));
    } catch (e) {
      setResendError(errorMessage(e));
    } finally {
      setResending(false);
    }
  };
  return (
    <AuthShell title={state === "working" ? "Verifying your email…" : state === "ok" ? "Email verified" : "This link has expired"}>
      {state === "working" && <p role="status" className="text-sm text-muted">One moment.</p>}
      {state === "ok" && (
        <>
          <div role="status" className="flex gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-sm leading-relaxed">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
            <p>Thanks, your email address is confirmed.</p>
          </div>
          <Link to={me ? "/app" : "/login"} className={clsx(buttonClass({ variant: "primary", size: "lg" }), "mt-5 w-full")}>{me ? "Continue to LifePilot" : "Sign in"}</Link>
        </>
      )}
      {state === "error" && (
        <>
          <div role="alert" className="flex gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm leading-relaxed">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            <p>This verification link is invalid, has expired or has already been used. Verification links work for 48 hours.</p>
          </div>
          {me?.user.emailVerified ? (
            <Link to="/app" className={clsx(buttonClass({ variant: "primary", size: "lg" }), "mt-5 w-full")}>Your email is already verified, continue</Link>
          ) : me ? (
            <div className="mt-5 flex flex-col gap-3">
              {resendError && <ErrorNote error={new Error(resendError)} />}
              {resent?.devMail ? (
                <DevMailNote devMail={resent.devMail} action="Verify my email" />
              ) : resent ? (
                <p role="status" className="text-sm">We've sent a new link to <strong>{me.user.email}</strong>.</p>
              ) : (
                <Button variant="primary" size="lg" className="w-full" loading={resending} onClick={resend}>Send a new link</Button>
              )}
            </div>
          ) : (
            <Link to="/login" state={{ from: "/app/settings?tab=security" }} className={clsx(buttonClass({ variant: "primary", size: "lg" }), "mt-5 w-full")}>
              Sign in to get a new link
            </Link>
          )}
        </>
      )}
    </AuthShell>
  );
}
