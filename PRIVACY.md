# Preflight privacy

Preflight processes files on your device. It has no backend, accounts, analytics, advertising, or remote OCR/compression service. Bundled PDF and OCR libraries do not download runtime code or language models.

## Files and clipboard

Files you open, screenshots you request, and clipboard images you explicitly paste are processed in browser memory. Preflight does not overwrite your original disk files. Copy actions write a result to your clipboard; Download actions save a separate file. Continuing an upload supplies the reviewed file to the website you selected. That website's privacy policy applies to the upload.

## Local storage

- Preferences are stored in extension-owned browser local storage.
- Recent activity metadata is stored for the browser session.
- One pending workspace file and one last image result may be cached in extension-owned IndexedDB for handoff and the last-result shortcut. Consumed pending files are deleted. Entries older than one hour are discarded on their next access; this is not a scheduled secure-erasure guarantee.
- Temporary processing documents and frames are closed after each task. Uninstalling removes browser-managed extension storage.

## Permissions

| Permission | Purpose |
| --- | --- |
| Website access | Review standard file inputs and display requested area capture controls. Firefox may ask you to grant site access separately. |
| `activeTab` | Capture the browser viewport following your action. |
| `scripting` | Load the local PDF engine into a website's isolated extension context when needed. |
| `storage` | Preferences, session metadata and file handoff. |
| `clipboardWrite` | Copy images or extracted text following your action. |
| `offscreen` (Chromium package) | Run bundled PDF/OCR workers for website review. Firefox uses a background frame instead. |

Preflight cannot capture browser settings or extension-store pages. Turning off website review in Preferences disables file interception. It is not a security boundary: custom upload widgets and earlier page listeners may bypass review.

Questions or bug reports: [GitHub issues](https://github.com/FutureAlok1445/Preflight-Lightweight-File-Review-Before-Upload/issues). Avoid posting private documents with a bug report.
