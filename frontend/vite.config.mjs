import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4174,
    proxy: {
      "/api": "http://127.0.0.1:8770",
      "/media": "http://127.0.0.1:8770",
      "/exports": "http://127.0.0.1:8770",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
