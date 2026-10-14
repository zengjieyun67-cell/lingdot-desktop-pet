// Bundles the MV3 extension into dist/ (load dist/ as an unpacked extension).
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });

const common = { bundle: true, target: "chrome116", logLevel: "info", minify: false, sourcemap: false, legalComments: "none" };
const builds = [
  // service worker: ES module (manifest background.type = "module")
  { ...common, entryPoints: ["src/background.ts"], outfile: "dist/background.js", format: "esm" },
  // content scripts registered via chrome.scripting cannot be modules -> IIFE
  { ...common, entryPoints: ["src/content.ts"], outfile: "dist/content.js", format: "iife" },
  { ...common, entryPoints: ["src/popup.ts"], outfile: "dist/popup.js", format: "iife" },
  { ...common, entryPoints: ["src/options.ts"], outfile: "dist/options.js", format: "iife" },
];

if (watch) {
  for (const b of builds) (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
