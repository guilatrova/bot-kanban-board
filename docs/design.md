# Board editor design

## Component map

- `editor/popover.ts` positions and dismisses menus for toolbar filters and settings.
- `editor/dom.ts` supplies `el` and `button` for editor controls and `badge` for bot identity.
- `editor/lanes.ts` supplies `icon` for lane headers and toolbar controls.
- `editor/styles.css` supplies the repository filter’s `.checkbox-mark` for checked rows and `.info-tip` for the “No repo” explanation.
- `editor/settings.ts` builds the switches for board display and merge preferences.
- `editor/merge-dialog.ts` presents merge assessment and confirmation. `editor/merge-toasts.ts` presents the undo footer and merge results.
