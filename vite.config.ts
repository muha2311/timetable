import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the Cloudflare Pages Functions (/api/*) run in `wrangler pages dev` on port 8788; Vite forwards /api there.
export default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://127.0.0.1:8788" } } });
