import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./lib/api-client";
import { loadRuntimeConfig } from "./lib/runtime-config";
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

// Async bootstrap (no module-level top-level await — unsupported by the build
// target). Loads deploy-time runtime config (/config.json), then configures
// Amplify and renders. Config must resolve before any API call.
async function bootstrap(): Promise<void> {
  const runtimeConfig = await loadRuntimeConfig();

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: runtimeConfig.cognito.userPoolId,
        userPoolClientId: runtimeConfig.cognito.userPoolClientId,
      },
    },
  });

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
}

void bootstrap();
