# Board editor design

## Component map

- `editor/popover.ts` positions and dismisses menus for toolbar filters and settings.
- `editor/dom.ts` supplies `el` and `button` for editor controls and `badge` for bot identity.
- `editor/lanes.ts` supplies `icon` for lane headers and toolbar controls.
- `editor/styles.css` supplies the repository filter’s `.checkbox-mark` for checked rows and `.info-tip` for the “No repo” explanation.
- `editor/settings.ts` builds the switches for board display and merge preferences.
- `editor/merge-dialog.ts` presents merge assessment and confirmation. `editor/merge-toasts.ts` presents the undo footer and merge results.
- The toast stack in `editor/merge-toasts.ts` owns the bulk summary, result rows, and Open links. Copy links and × use `button` from `editor/dom.ts`.
- `editor/merge-queue.ts` runs the batch and skips blocked PRs using the blockers and warnings assessed in `src/core/merge.ts`.
- The undo footer for merged PRs remains independent of the summary in `editor/merge-toasts.ts`.
