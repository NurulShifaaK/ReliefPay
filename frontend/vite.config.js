import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin /api calls -> FastAPI (keeps the secure session cookie working)
    proxy: { "/api": "http://localhost:8000" },
  },
});
