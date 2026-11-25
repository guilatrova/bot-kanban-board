# Feasibility findings

Tested on 2026-11-25 against Orca 1.4.274 (host API 1.10), on a headless Linux Orca host with six
bots, and from a Mac paired to it. Each line says how it was checked. Treat "not tested" as open.

## Works (tested)

| What | How it was checked |
| --- | --- |
| Read every bot's open Items as JSON | `orca bot item list --bot <name> --json` for all six bots. Fields include `status`, `title`, `description`, `doneMeans`, `chat`, `question`, `wait`, `links`, `snoozedUntil`, `lastActivityAt`. |
| Read every bot's workers | `orca bot work list --bot <name> --json`, run as the user. Run from inside a bot session it is refused ("A bot can reach only its own work"), so the worker must not inherit a bot's `ORCA_AGENT_SESSION_ID`, `ORCA_BOT_TOOLS_TOKEN` and similar variables. |
| Read every workspace with its bot and branch | `orca worktree ps --since 30d --json` (`bot`, `branch`, `repo`, `displayName`, `status`). |
| List open pull requests across repositories | One GraphQL search (`is:pr is:open user:<login>`) through `gh api graphql`. Asking for `statusCheckRollup` on 100 pull requests at once failed; 40 per page worked. |
| Map a pull request to its bot and Item | Three signals, joined: (1) the pull request's head branch equals a bot workspace's branch; (2) an Item's text (description, worker report) names the pull request; (3) the pull request closes an issue that an Item names. All five recent bot pull requests mapped. |
| Reach a paired Orca server from another computer | On the Mac: `orca bot list --environment <saved name>` listed the Linux host's six bots. |
| Merge permission | `gh api repos/<owner>/<repo>` reports push permission and the allowed merge methods. |

## Does not work today (tested)

| What | What happened |
| --- | --- |
| Change an Item's status as the owner | `orca bot item set <n> --status ...` run as the user: "Only a bot writes items, from one of its own chats." |
| Snooze an Item | Items carry `snoozedUntil`, but no CLI command sets it. |
| Answer a Needs you question | Same refusal as status changes. Upstream request: stablyai/orca#48010. |
| `pr` field on `bot work list` | Empty on all 13 of one bot's workers, including ones that clearly opened a pull request. Do not rely on it. |
| Item to pull request links | Only 1 of 11 open Items had a `pr` link. Use the three-signal mapping above. |
| One query for every computer | There is no all-hosts query. Ask each environment and join. |
| Plugin service on a headless host | `orca plugin list` there: "Plugin service is not available on this runtime". The plugin runs in the desktop app. `orca plugin test` also failed there (missing `orca-test-register.mjs`). |

Workaround for the first three: send the bot a message (`orca orchestration send --to bot:<name>`)
asking it to apply the change itself. It works but is not instant and costs the bot a turn. Not
tested end to end.

## From the docs, not tested here

- A `trusted-worker` plugin "runs its own code in a separate Node.js process on the Orca host, with
  your user account's access", so it can run `orca` and `gh`. Panels and editors have no network.
- Panels live in the right sidebar only. A full-width view needs a custom editor for a file type.
- `workspace.open` and `terminal.focus` show a workspace or terminal. No host method opens a bot
  Item or a specific bot chat.
- `shell.openExternal` opens an http(s) URL from a click, with a consent prompt per host.
- Plugin storage (`storage:own`) is available to worker and panels.
- Bot avatars exist as `avatar.png` in each bot's home folder on its own host. No command returns
  them, so showing a remote bot's avatar needs a way to fetch the file.

## Not tested

- Running the plugin's worker inside the Mac desktop app.
- Reading Items, workers and workspaces with `--environment` from the Mac (only `bot list` was run).
- `gh pr ready` followed by `gh pr merge` from the plugin.
- Whether Orca's own file diff tab (`orca file diff`) can show a pull request's committed changes.
  Rendering the diff in the plugin from `gh pr diff` avoids the question.

## Prior art: penguinwokrs/orca-items-board (MIT, 0.3.0)

It already ships the Items half: a full-width board as a custom editor, read through the CLI by a
trusted worker, polled every 30 seconds. It has no pull requests, no paired servers, no drag, no
avatars. Lessons recorded in its README and ADRs:

- The deep link `orca://bot/<id>` does nothing visible while a file tab is in front. Find the
  chat's folder workspace with `orca agent list --json` and call `workspace.open` instead.
- `editor.open` needs a file inside a workspace. It keeps the board file in its own app-data folder,
  registered once as a hidden folder project, after first trying a checkout's `.git` folder.
- A chat's "last asked" is often mail from Orca or another bot, not the owner's words.
- One stored value holds up to 256 KiB.
- It was built and tested on Linux only; Windows and macOS paths are unit-tested, not run.
- Its answer-in-place UI is kept behind a flag until Orca adds an owner API.
- Useful extras: a status bar counter ("Needs you n"), grouping Items by the chat they came from,
  and a demo mode with made-up data for screenshots.
