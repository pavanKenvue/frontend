#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

apps_json="${1:-$script_dir/apps.json}"
bucket_name="${2:-}"

if [ -z "$bucket_name" ]; then
  echo "Usage:"
  echo "  $0 <apps.json> <bucket-name>"
  echo ""
  echo "Example:"
  echo "  $0 apps.json argus-cpd-dashboard-web-859217211726"
  exit 1
fi

cd "$repo_root"

if [ ! -f "$apps_json" ]; then
  echo "ERROR: apps config not found: $apps_json" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required" >&2
  exit 1
fi

name_re='^[A-Za-z0-9_-]+$'
count=0

echo "Cleaning local build folder..."
rm -rf build
mkdir -p build

while IFS=$'\t' read -r name title api_base_url; do
  [ -n "$name" ] || continue

  count=$((count + 1))

  if ! [[ "$name" =~ $name_re ]]; then
    echo "ERROR: Invalid app name '$name'" >&2
    exit 1
  fi

  echo "=================================================="
  echo "[$count] $name"
  echo "=================================================="

  #
  # Delete previous S3 artifacts
  #
  echo "Deleting old artifacts from S3..."

  aws s3 rm "s3://${bucket_name}/${name}.html" 2>/dev/null || true
  aws s3 rm "s3://${bucket_name}/${name}/" --recursive 2>/dev/null || true

  #
  # Build app
  #
  VITE_APP_TITLE="$title" \
  VITE_API_BASE_URL="$api_base_url" \
  npm run build -- \
    --outDir "build/$name" \
    --assetsDir "$name"

  #
  # Move HTML to build root
  #
  mv "build/$name/index.html" "build/${name}.html"

  echo "Created:"
  echo "  build/${name}.html"
  echo "  build/${name}/"
  echo

done < <(node -e '
const fs = require("fs");
const path = process.argv[1];

const apps = JSON.parse(fs.readFileSync(path, "utf8"));

if (!Array.isArray(apps)) {
  throw new Error("apps.json must be a JSON array");
}

const clean = (v) => String(v ?? "").replace(/[\t\n\r]/g, " ").trim();

for (const app of apps) {
  const name = clean(app.name);
  const title = clean(app.title ?? app.name);
  const apiBaseUrl = clean(app.apiBaseUrl);

  process.stdout.write(`${name}\t${title}\t${apiBaseUrl}\n`);
}
' "$apps_json")

if [ "$count" -eq 0 ]; then
  echo "ERROR: No apps found in $apps_json" >&2
  exit 1
fi

echo
echo "Uploading build folder to S3..."

aws s3 sync build/ "s3://${bucket_name}/" \
  --delete

echo
echo "Build completed."
echo "Apps built: $count"
echo "S3 Bucket: $bucket_name"