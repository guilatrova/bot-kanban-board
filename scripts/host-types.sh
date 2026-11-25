#!/usr/bin/env bash
# CI and headless installations lack the desktop's bundled author typings.
set -euo pipefail
dest=.orca/types
mkdir -p "$dest"
base=https://raw.githubusercontent.com/stablyai/orca/v1.4.274/resources/plugins
for unit in orca orca-frame orca-worker orca-host orca-services orca-components orca-components-layout orca-components-data; do
  case "$unit" in orca|orca-components*) group=declarative ;; *) group=types ;; esac
  mkdir -p "$dest/$unit"
  curl --retry 3 -fsSL "$base/$group/$unit.d.ts" -o "$dest/$unit/index.d.ts"
done
echo '{"compilerOptions":{"target":"ES2022","lib":["ES2023","DOM","DOM.Iterable"],"module":"ESNext","moduleResolution":"Bundler","skipLibCheck":true}}' > "$dest/tsconfig.json"
