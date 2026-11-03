/**
 * sync-version-carriers — pone la versión del release en los ficheros que
 * release-please no actualiza.
 *
 * Uso: `pnpm exec tsx scripts/sync-version-carriers.ts <semver>`
 *
 * La tabla de carriers vive en `scripts/lib/version-carriers.ts` y la usa
 * también `pnpm check:version`: los dos leen la misma, así que un carrier
 * nuevo está cubierto por los dos caminos sin tocar dos listas.
 *
 * Sale con código 1 si algún carrier que debería llevar la versión no la
 * lleva: el pipeline de release no tiene que publicar un tag con la versión
 * a medias.
 */
import process from "node:process";
import { syncCarriers } from "./lib/version-carriers.ts";

const root = process.cwd();
const version = process.argv[2] ?? process.env["RELEASE_VERSION"];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: pnpm exec tsx scripts/sync-version-carriers.ts <semver>");
  process.exit(1);
}

const results = syncCarriers(root, version);
let broken = 0;

for (const result of results) {
  switch (result.status) {
    case "updated":
      console.log(`updated ${result.path}`);
      break;
    case "unchanged":
      console.log(`already at ${version}: ${result.path}`);
      break;
    case "missing":
      console.log(`skipped (not in the tree): ${result.path}`);
      break;
    case "no-match":
      console.error(`::error::${result.path} does not carry a version to update`);
      broken += 1;
      break;
  }
}

if (broken > 0) {
  console.error(`${broken} version carriers could not be synchronized.`);
  process.exit(1);
}

console.log(`Version carriers synchronized to ${version}.`);
