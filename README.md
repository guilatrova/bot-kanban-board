# Orca Bots Board

An [Orca](https://orca.dev) plugin: one kanban for every bot's Items and the pull requests
waiting to be merged, across this computer and paired Orca servers.

Status: planning. Requirements arrive as GitHub issues; nothing is built yet.

## What it will do

- Show every bot's Items by status (Planned, Needs you, In progress, Waiting).
- Show open pull requests, each mapped to the bot and Item that produced it.
- Open a card to read the bot's question, the latest worker report and the linked pull requests.
- Read a pull request's diff in place, and merge it by dragging it to a Merged column.
- Read bots on paired Orca servers (for example a Mac showing the bots that run on a Linux host).

## Docs

- [docs/feasibility.md](docs/feasibility.md): what was tested against Orca 1.4.274, what works,
  what does not, and what is still unverified. Read it before designing anything.
