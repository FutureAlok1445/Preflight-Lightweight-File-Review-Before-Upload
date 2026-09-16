# PREflight ✈️

> **Optimize before you upload.**  
> A private, zero-network, local-first browser extension for Chromium browsers (Chrome, Edge, Brave, Opera GX, Vivaldi, Arc). Review, compress, edit, snip, and prepare images, PDFs, and text documents locally in your browser before uploading them anywhere.

---

## 🔒 100% Private & Local
- **Zero Server Uploads**: No backend, no APIs, no analytics, no external servers.
- **In-Memory Only**: All image compression, PDF operations, and text parsing happen directly on your machine inside browser memory.
- **Never Overwrites**: Your original files on disk remain untouched.
- **Explicit Confirmation**: Files are never uploaded without your explicit approval.

---

## ✨ Features

### 📸 1. Custom Area Screenshot (Lightshot / Snipping Tool Style)
- Click **"Select Area to Snip"** to dim any web page and draw a custom crop box.
- Live pixel dimension indicators (`W × H`) with corner/edge resize handles.
- High-DPI Retina resolution support (`window.devicePixelRatio`).
- Directly opens into the PREflight workspace to compress, download, or copy to clipboard.
- Also supports instant **Full Tab Capture**.

### ⚡ 2. Smart 2-Step On-Page Upload Review
When you click **"Choose File"** on any website:
1. **Step 1 — Decision Card**: Detects the file, checks website size limits (e.g., `Site limit detected: 5 MB`), and gives options:
   - `[ Compress / Optimize ]` (or `[ Compress PDF ]` / `[ Clean Text ]`)
   - `[ Continue with Original ]`
   - `[ Cancel ]`
   - `Open in Full Workspace...`
2. **Step 2 — Confirmation Card**: Shows comparison (`Original` vs `Optimized` vs `% Saved`), with immediate actions:
   - `[ Continue Upload ]` (automatically supplies the optimized file to the form input)
   - `[ Download ]`
   - `[ Copy ]`

### 📄 3. Local PDF Tools (Powered by `pdf-lib`)
- **PDF Compression**: Strips metadata, unreferenced objects, and re-encodes streams without touching text/vector quality.
- **PDF Split / Range Extract**: Extract pages or custom page ranges (e.g. `1-3, 5, 8`) into a new PDF.
- **PDF Merge**: Combine multiple PDF files into one with reorder (Up/Down) controls.
- **Text to PDF**: Generate clean paginated PDF documents from raw text with automatic wrapping.

### 🖼️ 4. Image Optimizer
- **Formats**: Auto (Smart Match), WebP, JPEG, PNG.
- **Compression**: Bounded quality slider (35% to 95%).
- **Resizing**: Max dimension constraints (Original, 2400px, 1920px Full HD, 1280px 720p).
- **Inspection**: Split Before / After tabs to verify visual fidelity.
- **One-Click Clipboard**: Copy optimized image directly to clipboard.

### 📝 5. Text & CSV Cleaner
- **Structure Analysis**: Word count, line count, character count, delimiter detection (`,`, `;`, `\t`).
- **Whitespace Cleaner**: Removes empty lines and trailing whitespace without touching your data.
- **CSV to JSON**: Instant local conversion of tabular CSV files into formatted JSON.

---

## 🌐 Browser Compatibility

PREflight is built for **all Chromium-based desktop browsers**:

| Browser | Supported | Installation URL |
| :--- | :---: | :--- |
| **Google Chrome** | ✅ Yes | `chrome://extensions` |
| **Microsoft Edge** | ✅ Yes | `edge://extensions` |
| **Brave Browser** | ✅ Yes | `brave://extensions` |
| **Opera / Opera GX** | ✅ Yes | `opera://extensions` |
| **Vivaldi** | ✅ Yes | `vivaldi://extensions` |
| **Arc Browser** | ✅ Yes | `arc://extensions` |

*(Note: Apple Safari requires native macOS wrappers and is not supported. Mozilla Firefox uses different background script packaging; Chromium is the recommended engine).*

---

## 🚀 Quick Start / Installation Guide

Anyone with this GitHub link can install and use PREflight in less than 60 seconds:

### Step 1: Download the Project
- Click the green **Code** button at the top of this GitHub repository and select **Download ZIP**.
- Extract the ZIP file onto your computer (e.g., Desktop or Documents).  
  *(Or run `git clone https://github.com/YourUsername/preflight.git` in your terminal).*

### Step 2: Open Extensions in Your Browser
Open your Chromium browser and visit the extensions settings page:
- **Chrome**: `chrome://extensions`
- **Edge**: `edge://extensions`
- **Brave**: `brave://extensions`
- **Opera**: `opera://extensions`

### Step 3: Enable Developer Mode
Turn on the **"Developer mode"** toggle switch (usually found in the top-right or left sidebar).

### Step 4: Load the Extension
1. Click the **"Load unpacked"** button.
2. Select the extracted `preflight` folder (the folder containing `manifest.json`).
3. **Done!** PREflight is now active in your browser. Pin it to your toolbar for instant access!

---

## 📂 Project Structure

```
preflight/
├── manifest.json              # Chrome Manifest V3 configuration
├── background.js              # Service worker (tab capture, area snipper, message routing)
│
├── core/                      # Shared zero-dependency local engines
│   ├── utils.js               # Unit formatting, MIME detection, filename safety, storage bridge
│   ├── file-analyzer.js       # File metadata extraction & supported action resolution
│   ├── image-optimizer.js     # OffscreenCanvas / HTML5 canvas compression & resizing
│   ├── smart-profile.js       # Smart heuristics for optimal compression presets
│   ├── pdf-processor.js       # Local PDF engine (compress, split, merge, text-to-pdf)
│   ├── text-processor.js      # Text analysis, whitespace cleaner, and CSV to JSON converter
│   ├── clipboard.js           # Async Clipboard API wrapper
│   ├── downloader.js          # In-memory blob download triggers
│   ├── result-model.js        # Standardized optimization result object model
│   ├── batch-processor.js     # Queue processor for multi-file batches
│   └── recent-history.js      # Session-based recent history tracker
│
├── upload/                    # In-page website interception
│   ├── upload-detector.js     # Content script intercepting file inputs on websites
│   ├── upload-ui.js           # Isolated Shadow DOM review card
│   └── area-snipper.js        # Interactive screenshot snipping overlay
│
├── popup/                     # Toolbar popup UI
│   ├── popup.html             # Popup interface
│   ├── popup.css              # Editorial clean monochrome styling
│   └── popup.js               # Screenshot triggers, dropzone, and settings
│
├── optimizer/                 # Full standalone workspace
│   ├── optimizer.html         # Multi-tool workspace (Images, PDFs, Text, Archive)
│   ├── optimizer.css          # Workspace styles
│   ├── optimizer.js           # Controller wiring all local engines
│   └── comparison-slider.js   # Interactive before/after preview controller
│
├── lib/
│   └── pdf-lib.min.js         # Bundled standalone UMD PDF library (zero network calls)
│
├── icons/                     # Application icons (16px, 32px, 48px, 128px)
│
└── tests/                     # Vitest + fast-check test suites (36 passing tests)
```

---

## 🧪 Development & Testing

PREflight includes a comprehensive test suite covering core utilities, property-based tests, and integration flows:

```bash
# Install test dependencies (Vitest & fast-check)
npm install

# Run all tests
npm test
```

**Test Status:** 10 / 10 test suites passed (36/36 tests passing).

---

## 📜 License

MIT License. Free and open source for personal and commercial use.
