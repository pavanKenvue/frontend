set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
apps_json="${1:-$script_dir/apps.json}"

cd "$repo_root"

if [ ! -f "$apps_json" ]; then
  echo "error: apps config not found: $apps_json" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (used to parse $apps_json)" >&2
  exit 1
fi

name_re='^[A-Za-z0-9_-]+$'
count=0


while IFS=$'\t' read -r name title api_base_url; do
  [ -n "$name" ] || continue
  count=$((count + 1))

  if ! [[ "$name" =~ $name_re ]]; then
    echo "error: app #$count has an invalid \"name\" ('$name') — only letters, digits, '-', '_' allowed" >&2
    exit 1
  fi
  if [ -z "$api_base_url" ]; then
    echo "error: app \"$name\" has no \"apiBaseUrl\" in $apps_json" >&2
    exit 1
  fi

  echo "── [$count] $name  (\"$title\", $api_base_url) ──────────────────────────"
  VITE_APP_TITLE="$title" VITE_API_BASE_URL="$api_base_url" \
    npm run build -- --outDir "$name" --assetsDir "$name"
  mv "$name/index.html" "$name/$name.html"
  echo "   -> $name/$name.html"
  echo
done < <(node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const apps = JSON.parse(fs.readFileSync(path, "utf8"));
    if (!Array.isArray(apps)) throw new Error("apps.json must be a JSON array");
    const clean = (v) => String(v ?? "").replace(/[\t\n\r]/g, " ").trim();
    for (const app of apps) {
      const name = clean(app.name);
      const title = clean(app.title ?? app.name);
      const apiBaseUrl = clean(app.apiBaseUrl);
      process.stdout.write(`${name}\t${title}\t${apiBaseUrl}\n`);
    }
  ' "$apps_json")

if [ "$count" -eq 0 ]; then
  echo "error: no apps found in $apps_json" >&2
  exit 1
fi

echo "Built $count app(s) from $apps_json"
