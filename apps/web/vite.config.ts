import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command, mode }) => {
  if (command === "build" && mode === "mock") {
    throw new Error("Cannot produce a production build in mock mode.");
  }
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      strictPort: false,
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
