#!/usr/bin/env bash
# Deploys the static demo build to Vercel. The CLI would otherwise read the Dockerfile as a
# container service, so we upload only the built files plus the routing and header rules.
# Needs VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID in the environment.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build:demo
out=$(mktemp -d)
cp -r apps/web/dist/. "$out/"
node -e 'const v=require("./vercel.json");delete v.installCommand;delete v.buildCommand;delete v.outputDirectory;require("fs").writeFileSync(process.argv[1]+"/vercel.json",JSON.stringify(v))' "$out"
mkdir -p "$out/.vercel"
printf '{"orgId":"%s","projectId":"%s"}' "$VERCEL_ORG_ID" "$VERCEL_PROJECT_ID" > "$out/.vercel/project.json"
cd "$out" && NODE_USE_ENV_PROXY=1 npx -y vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"
