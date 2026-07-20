import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  envDir: "../..",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, "artifact-runtime.html")
    }
  }
});
