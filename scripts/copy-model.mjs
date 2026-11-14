// Copies the trained model into the web app so the browser demo can load it.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "apps/web/public"), { recursive: true });
copyFileSync(resolve(root, "models/model.json"), resolve(root, "apps/web/public/model.json"));
