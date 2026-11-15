import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui";

/**
 * Catches rendering errors so one broken component shows a recovery message instead of a blank
 * page. `resetKey` (e.g. the route path) clears the error when the user navigates elsewhere.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("LifePilot UI error", error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-12 max-w-md rounded-xl border border-line bg-surface p-6 text-center">
        <AlertTriangle className="mx-auto size-8 text-warn" aria-hidden />
        <h2 className="mt-3 text-base font-semibold">Something went wrong on this page</h2>
        <p className="mt-1 text-sm text-muted">Your data is safe. Try again, or go to another page from the menu.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" /> Reload
          </Button>
        </div>
      </div>
    );
  }
}
