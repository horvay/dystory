import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const convexUrl = env.VITE_CONVEX_URL || "http://127.0.0.1:3210";
  const mediaUrl = `http://127.0.0.1:${env.MEDIA_PORT || 5191}`;
  const sttUrl = `http://127.0.0.1:${env.STT_PORT || 5193}`;
  // The browser reaches Convex, the media server and the speech server
  // through this one origin, so only one port has to be published (see README).
  const proxy = {
    "/api": { target: convexUrl, ws: true, changeOrigin: true },
    "/media": { target: mediaUrl, changeOrigin: true },
    "/stt": { target: sttUrl, changeOrigin: true },
  };
  // Only on localhost: Tailscale serves it to the tailnet over HTTPS (see README).
  const server = {
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 5190),
    strictPort: true,
    allowedHosts: true as const,
    proxy,
  };
  return { plugins: [react(), tailwindcss()], server, preview: server };
});
