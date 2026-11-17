import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ApiError } from "./api";
import { ToastProvider } from "./components/toast";
import { clearUserData, SessionProvider } from "./session";
import "./index.css";

/**
 * The session ended elsewhere (signed out from another device, password reset, expiry): drop cached
 * data and mark the user signed out, so RequireAuth redirects to /login instead of every page erroring.
 * Only the "unauthenticated" code counts: a wrong password (e.g. deleting the account) is also a 401.
 */
function onSessionLost(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401 || err.code !== "unauthenticated") return;
  if (queryClient.getQueryData(["me"]) === null) return;
  clearUserData(queryClient);
  queryClient.setQueryData(["me"], null);
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onSessionLost }),
  mutationCache: new MutationCache({ onError: onSessionLost }),
  defaultOptions: {
    queries: {
      retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 2,
      refetchOnWindowFocus: true,
      staleTime: 15_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
