import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var envDir = "../..";
    var env = loadEnv(mode, envDir, "");
    var convexUrl = env.VITE_CONVEX_URL || env.CONVEX_URL || "";
    return {
        envDir: envDir,
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
