import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const envDir = "../..";
  const env = loadEnv(mode, envDir, "");
  const convexUrl = env.VITE_CONVEX_URL || env.CONVEX_URL || "";

  return {
    envDir,
    define: {
      "import.meta.env.VITE_CONVEX_URL": JSON.stringify(convexUrl)
    },
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": "http://localhost:3000",
        "/knowledge": "http://localhost:3000"
      }
    }
  };
});
