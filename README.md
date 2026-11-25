# Orca Bots Board

Open **Open bots board** from the Orca command palette to see open Items on this computer and its saved paired computers. Select **Needs you** in the status bar to jump to the oldest outstanding questions. Click a bot to filter, or Alt-click or Cmd-click to show that bot alone.

Item drawers show the question, suggested replies, worker reports and links to related pull requests. **Answer in Orca** opens the bot workspace so you can reply in its chat. Pull request drawers show changed files, expandable diffs and links to GitHub. The board matches pull requests by workspace branch, direct Item reference or closing issue.

## Install

Use Orca desktop 1.4.274 or later on macOS or Linux. Install the Orca CLI and GitHub CLI, then sign in with `gh auth login`. From the checkout, run `orca plugin dev load . --json`. Review the requested permissions and follow the approval command Orca prints. Open the board from your own desktop session.

## Settings

| Setting                       | Default                                |
| ----------------------------- | -------------------------------------- |
| Orca executable path          | Search PATH and platform CLI locations |
| GitHub CLI executable path    | Search PATH and platform CLI locations |
| Item refresh interval         | 30 seconds                             |
| Pull request refresh interval | 90 seconds                             |

**Refresh** reads both sources immediately. A GitHub failure keeps the last successful pull request list with its age. Only the bot filter is stored between sessions.

## Known limits

- GitHub search reads up to five pages of 40 open pull requests. The board shows the open total. The PR files API returns up to 3,000 files. When fewer files arrive than the reported number of changes, the drawer shows both counts and a GitHub files link. Binary and large files can have no patch.
- Remote bots use initials. Orca's file commands open tabs, and its terminal read command reads terminal output. Neither returns the contents of a paired bot's avatar file. Local bots use initials if their PNG is unavailable.
- Orca opens a bot's workspace. Select the original chat there to answer. The bot deep link is a fallback when the folder workspace cannot be opened.
- Desktop operation and paired-computer jumps still need an end-to-end run on a Mac. The CLI runner detects inherited bot-session context and directs the operator to open the board from the desktop as themselves.

## Development

Install the pinned pnpm version and run `pnpm install --frozen-lockfile`. Generate host declarations with `orca plugin types . --json`, or use `bash scripts/host-types.sh` on headless machines without the bundled declarations. Run `pnpm check` for formatting, strict type checks, lint and core unit tests. The plugin loads its TypeScript directly. The synthetic demo entry is `editor/demo.html` and can be served by a TypeScript-aware development server.
