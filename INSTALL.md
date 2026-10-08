# Install Preflight — student guide

## Free installation today: Chrome / Edge / Brave / Opera / Vivaldi

1. Open [Preflight downloads](https://github.com/FutureAlok1445/Preflight-Lightweight-File-Review-Before-Upload/releases/latest).
2. Download **preflight-chromium-1.3.0.zip** and extract it to a permanent folder, such as Documents/Preflight. Do not delete this folder after installing.
3. Open your browser's extensions page:

   | Browser | Address |
   | --- | --- |
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Brave | `brave://extensions` |
   | Opera / Opera GX | `opera://extensions` |
   | Vivaldi | `vivaldi://extensions` |

4. Turn on **Developer mode**. Choose **Load unpacked**, then select the extracted folder containing `manifest.json`.
5. Pin Preflight in the extensions menu. Click its icon → **Open file workbench**.

No Node.js, npm, payment, or account is needed. Your browser may show a developer-extension warning. A school-managed browser may block developer mode; ask the school IT administrator to deploy it. Do not change administrator policies yourself.

## Use it

- **PDF:** Choose a file → set Desired size reduction (for example 80%) or Target size (for example 2 MB). Wait for the measured size. Compress → Download. Whole-page image compression needs your checkbox and removes selectable text, links, forms and bookmarks.
- **Image:** Adjust quality, format and dimensions. The live preview shows the encoded result and actual size. PNG uses lossless encoding.
- **Screenshot:** Select an area, then choose Text, Pen, Extract text, Copy or Save. Click Text to create a box immediately; click and move the text directly. The capture area can move and resize too.
- **Extract text:** Choose Extract text → Copy. English and English + Hindi are available under More. Check OCR for mistakes.
- **Website upload:** Choose a supported file on a normal website. Review it, then explicitly choose Continue with Original or Continue Upload. No preview authorizes an upload.

## Update

Download the new ZIP and extract it over the same installation folder. Click **Reload** on the extension card, refresh websites, and close/reopen the workspace. GitHub/manual installations do not update automatically.

## Firefox

The Firefox ZIP is a **publisher/development package**, not a signed student installer. To test it, extract it, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select its `manifest.json`. Firefox removes temporary add-ons when it restarts. Grant website access when Firefox asks, so upload review and snipping can run.

For a permanent, easy installation, the publisher must submit the Firefox package to Mozilla for signing and share an AMO listing or a signed XPI. Do not disable Firefox signing protections. See [Mozilla distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## Share with 100 students

Share the GitHub downloads link and this guide for a free pilot. Demonstrate the five installation steps once in class. No server is needed; each student's browser handles their files locally.

For ongoing use, a store listing gives students a simpler install and automatic updates:

| Route | Publisher cost | Student setup |
| --- | --- | --- |
| GitHub ZIP, unpacked | Free | Manual setup and manual updates; suitable for a pilot. |
| Microsoft Edge Add-ons | No registration fee | Install from a store link in Edge; review and account verification required. |
| Firefox / Mozilla AMO | Free submission/signing | Install a reviewed listing or signed XPI. |
| Chrome Web Store | One-time developer registration fee | Install a store link in Chrome; updates delivered by the store. An unlisted listing can be shared with your class. |

**Recommendation:** GitHub for a pilot today; Edge Add-ons for a free store rollout if students use Edge. If most students use Chrome, Chrome Web Store gives them the easiest long-term setup. Students do not pay the publisher registration fee.

Official references: [Chrome registration](https://developer.chrome.com/docs/webstore/register), [Chrome distribution](https://developer.chrome.com/docs/extensions/how-to/distribute), [Edge registration — no fee](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account), [Mozilla signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

Safari requires an Apple-specific extension package; the Chromium ZIP is not a Safari installer. Desktop packages are not promised to work in mobile Chrome or every mobile browser.
