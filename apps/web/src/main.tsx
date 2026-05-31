import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import { App } from "./App";
import "./index.css";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env["VITE_COGNITO_USER_POOL_ID"] as string,
      userPoolClientId: import.meta.env["VITE_COGNITO_CLIENT_ID"] as string,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
