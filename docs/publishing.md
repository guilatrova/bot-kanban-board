# Publish a version

Run these steps when the repository owner chooses to publish.

1. Set `version` in `orca-plugin.json`. Run `pnpm check`, `orca plugin validate . --json` and `orca plugin inspect . --json`. Check the reported version, entry points and permissions.
2. Commit the validated files and push to the public GitHub repository that will own the plugin. Its repository owner becomes the publisher.
3. Tag that commit with the manifest version, for example `git tag -a v1.2.0 -m v1.2.0` and `git push origin v1.2.0`.
4. Add the discovery topic with `gh repo edit <owner>/<repo> --add-topic orca-plugin`. Check the listing at `https://www.onorca.dev/plugins/<owner>/<repo>`.
5. For a catalog, run `orca plugin release-entry . --json` from the tagged commit. Paste its release entry first in the plugin's releases in `orca-catalog.json`, including the returned source path for a subdirectory plugin. Validate the catalog with `orca plugin validate orca-catalog.json` and submit the catalog change.
