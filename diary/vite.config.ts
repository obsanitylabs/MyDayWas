import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // OBS-789 — the diary app is served from the apex site at /app/
  base: "/app/",
  plugins: [react()],
  build: { outDir: "dist" },
});