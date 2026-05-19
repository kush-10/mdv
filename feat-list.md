# Feature List

## 1) Git Sync Mode (Local <-> Web) [Planned]
- Add a sync mode that maps local markdown files in a git folder to remote mdv document IDs.
- Keep `mdv push` consistent by always updating the tracked remote doc for a file.
- Add `mdv pull <file>` to bring remote/web edits back into the original local source file.
- Add `mdv pull --all` to sync all tracked files in the folder.
- Store sync metadata in config: server URL, local path, doc ID, and last synced revision.
- Add conflict protection:
  - block overwrite when both local and remote changed since last sync
  - show a clear conflict message and resolution steps
- Optional later: force flags for overwrite behavior.

## 2) Writing Speed Features (Markdown Editor) [Planned]
- Add link shortcut: `Cmd/Ctrl + K` to quickly create markdown links.
- If text is selected, wrap it as `[selected text](url)`.
- If no text is selected, insert a link template and place cursor in the right slot.
- Add smart paste: if a URL is pasted over selected text, convert it to a markdown link automatically.
- Add emoji autocomplete while typing `:shortcode` (keyboard navigation + Enter/Tab to insert).
- Keep compatibility with existing gemoji shortcodes (example: `:rocket:`, `:joy:`).
- Remap `Tab` in the raw editor so it inserts a tab/indent instead of moving focus to the previous control.
- Add optional keyboard profiles for navigation/editing behavior.
- Explore `vim` controls in preview mode (for example: `j/k` scroll, `gg/G`, and quick heading jumps).
- Explore VS Code-like shortcuts as an alternative profile.
- Make markdown task list checkboxes clickable in preview mode.
- Add a hide/show preview toggle for the raw Markdown editor.
