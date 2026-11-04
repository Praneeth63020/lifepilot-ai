import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { api, errorMessage } from "../api";
import { Logo } from "../components/Logo";
import { Button, ErrorNote, Field, Input } from "../components/ui";

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6">
        <Logo to="/" />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

const loginForm = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export function LoginPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState<string | null>(null);
  const f = useForm<z.infer<typeof loginForm>>({ resolver: zodResolver(loginForm) });
  const submit = f.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post("/auth/login", v);
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav((loc.state as { from?: string } | null)?.from ?? "/app");
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <AuthShell title="Sign in" subtitle={<>New here? <Link className="text-accent underline-offset-2 hover:underline" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorNote error={new Error(error)} />}
        <Field label="Email" htmlFor="email" error={f.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...f.register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" error={f.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...f.register("password")} />
        </Field>
        <Button type="submit" variant="primary" loading={f.formState.isSubmitting}>Sign in</Button>
        <Link to="/forgot-password" className="text-center text-sm text-muted hover:text-ink">Forgot password?</Link>
      </form>
    </AuthShell>
  );
}

const registerForm = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters"),
});

export function RegisterPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const f = useForm<z.infer<typeof registerForm>>({ resolver: zodResolver(registerForm) });
  const submit = f.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post("/auth/register", { ...v, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/onboarding");
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <AuthShell title="Create your account" subtitle={<>Already have one? <Link className="text-accent underline-offset-2 hover:underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorNote error={new Error(error)} />}
        <Field label="Name" htmlFor="name" error={f.formState.errors.name?.message}>
          <Input id="name" autoComplete="name" {...f.register("name")} />
        </Field>
        <Field label="Email" htmlFor="email" error={f.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...f.register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters." error={f.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" {...f.register("password")} />
        </Field>
        <Button type="submit" variant="primary" loading={f.formState.isSubmitting}>Create account</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthShell title="Reset your password">
      {sent ? (
        <p className="text-sm">If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires in 1 hour.</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.post("/auth/request-password-reset", { email });
              setSent(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <ErrorNote error={new Error(error)} />}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="mt-4 block text-center text-sm text-muted hover:text-ink">Back to sign in</Link>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthShell title="Choose a new password">
      {done ? (
        <p className="text-sm">Password updated. You've been signed out everywhere. <Link className="text-accent" to="/login">Sign in</Link></p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.post("/auth/reset-password", { token, password });
              setDone(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {!token && <ErrorNote error={new Error("This link is missing its token.")} />}
          {error && <ErrorNote error={new Error(error)} />}
          <Field label="New password" htmlFor="pw" hint="At least 10 characters.">
            <Input id="pw" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!token}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [msg, setMsg] = useState("");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; // tokens are single-use; don't double-submit in StrictMode
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setState("error");
      setMsg("This link is missing its token.");
      return;
    }
    api
      .post("/auth/verify-email", { token })
      .then(() => {
        setState("ok");
        qc.invalidateQueries({ queryKey: ["me"] });
      })
      .catch((e) => {
        setState("error");
        setMsg(errorMessage(e));
      });
  }, [params, qc]);
  return (
    <AuthShell title="Email verification">
      {state === "working" && <p className="text-sm text-muted">Verifying…</p>}
      {state === "ok" && <p className="text-sm">Your email is verified. <Link className="text-accent" to="/app">Continue</Link></p>}
      {state === "error" && <ErrorNote error={new Error(msg)} />}
    </AuthShell>
  );
}
