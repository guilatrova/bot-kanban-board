/**
 * Enables Move to, Complete, Cancel, the status selector, item drag, and the requested badge and dialog.
 * PLUGIN_HOST_API has no bots.* method, so orca.host.call('bots.items.owner.status', …) returns unknown_method.
 * The orca bot item set|done|cancel commands require a caller in the bot's own chat.
 * When Orca supports plugin item writes, flip to true and replace the paste dialog in move() with the host call.
 * https://github.com/guilatrova/bot-kanban-board/issues/33
 */
export const itemStatusActions = false
