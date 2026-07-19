import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    envDir: "../..",
    plugins: [react()],
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            "/api": "http://localhost:3000",
            "/knowledge": "http://localhost:3000",
            "/files": "http://localhost:3000"
        }
    }
});
