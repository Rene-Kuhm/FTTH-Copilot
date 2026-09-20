import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entrypointPath = resolve(repoRoot, "apps/web/dist/index.html");
const devUrl = process.env.TAURI_DEV_URL ?? "http://localhost:3001/";

const entrypoint = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>FTTH-Copilot</title>
  <meta http-equiv="refresh" content="0; url=${devUrl}">
  <style>
    body { background: #1a1218; color: #f6eff3; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    h1 { color: #f23077; }
  </style>
</head>
<body>
  <h1>FTTH-Copilot</h1>
  <p>Redirecting to app...</p>
</body>
</html>
`;

mkdirSync(dirname(entrypointPath), { recursive: true });
writeFileSync(entrypointPath, entrypoint, "utf8");

const generated = readFileSync(entrypointPath, "utf8");
if (!generated.includes("<title>FTTH-Copilot</title>") || !generated.includes(`url=${devUrl}`)) {
  throw new Error(`Tauri webview entrypoint verification failed: ${entrypointPath}`);
}

console.log(`Prepared Tauri webview entrypoint: ${entrypointPath}`);
