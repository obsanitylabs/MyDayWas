import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/MyDayWas/recovered/",
  plugins: [react()],
  build: { outDir: "dist" },
});