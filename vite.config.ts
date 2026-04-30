import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Inlines emitted CSS into the HTML <head> as <style> tags and removes the
// render-blocking <link rel="stylesheet"> elements. Keeps the CSS asset
// available on disk in case anything else references it.
function inlineCss(): Plugin {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const cssByName = new Map<string, string>();
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type === "asset" && name.endsWith(".css")) {
          cssByName.set(name, typeof asset.source === "string" ? asset.source : asset.source.toString());
        }
      }
      if (cssByName.size === 0) return;

      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".html")) continue;
        let html = typeof asset.source === "string" ? asset.source : asset.source.toString();

        for (const [name, css] of cssByName) {
          const linkRe = new RegExp(
            `<link[^>]*rel=["']stylesheet["'][^>]*href=["'][^"']*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*/?>`,
            "g",
          );
          html = html.replace(linkRe, `<style>${css}</style>`);
        }
        asset.source = html;
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineCss()],
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
