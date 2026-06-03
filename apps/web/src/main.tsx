import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./lib/api-client";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry up to 2 times on network errors; skip retries on 4xx (not transient)
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (n) => 1000 * 2 ** n,
    },
  },
});

const MOCK_MODE = import.meta.env.VITE_MOCK_API === "true";

// In mock mode auth is also mocked (see lib/auth.ts), so we skip Amplify
// configuration entirely to avoid errors from missing/placeholder env vars.
if (!MOCK_MODE) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string,
      },
    },
  });
}

if (MOCK_MODE) {
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
