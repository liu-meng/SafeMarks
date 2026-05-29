# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SafeMarks is a Chrome Manifest V3 extension that provides a locally-encrypted bookmark vault. All data stays in the browser — no accounts, no cloud sync. Bookmarks are AES-256-GCM encrypted with a key derived from the user's master password via PBKDF2 (100k iterations, SHA-256).

## Commands

- **Run tests:** `npm test` (uses Node.js built-in test runner, no dependencies needed)
- **Package for store submission:** `npm run package:extension` (outputs ZIP to `dist/`)
- **Load in Chrome:** Open `chrome://extensions`, enable Developer Mode, "Load unpacked" → select repo root

There is **no build step** and **no `npm install`**. The extension runs directly from source as ES modules.

## Architecture

### No Build Pipeline

All source files are vanilla JS ES modules loaded directly by the browser. The `manifest.json` points to source paths under `src/`. There is no bundler, transpiler, or framework.

### Core Layer (`src/core/`)

Pure-logic modules with no DOM or Chrome API side effects (except `storage.js` and `session.js`). This is the only layer covered by tests.

- **crypto.js** — Web Crypto API wrapper: PBKDF2 key derivation, AES-GCM encrypt/decrypt, key import/export. All crypto goes through this module.
- **vault.js** — Vault record lifecycle: create, unlock (password → key), encrypt/decrypt bookmark arrays. Uses crypto.js internally. A vault record has shape `{ version, salt, auth, vault, meta, settings }`.
- **storage.js** — `chrome.storage.local` persistence for vault records, pending quick captures, and folder catalog.
- **session.js** — `chrome.storage.session` for the ephemeral AES key and auto-lock timer via `chrome.alarms`. Also exposes `sendSessionMessage()` helpers that the UI layers use to communicate with the service worker.
- **validation.js** — Normalize/validate all data shapes (vault records, bookmarks, sessions, folder paths). Every read from storage or user input passes through this layer.
- **quick-capture.js** — Queue bookmarks while locked (stored unencrypted in `pendingQuickCaptures`), flush them into the vault on next unlock.
- **folder-catalog.js** — Derives and persists the set of known folder paths from the bookmark list, used by the folder picker UI.

### UI Pages (`src/popup/`, `src/manager/`, `src/options/`, `src/quick-capture/`)

Each page is an independent HTML+JS+CSS entry point. They share no framework — all DOM is built with `document.createElement`. Each page manages its own state object and event listeners, and communicates with the service worker via `chrome.runtime.sendMessage`.

### Service Worker (`src/background/service-worker.js`)

Message handler for session operations (SET/TOUCH/LOCK/STATUS) and badge management. Listens to `chrome.commands` for keyboard shortcuts and `chrome.alarms` for auto-lock.

### I18n (`src/shared/i18n.js`)

Custom runtime i18n — not Chrome's built-in `chrome.i18n`. Source strings are written in Chinese and an `EN_TRANSLATIONS` map provides English translations. The `t()` function resolves at runtime based on a stored language preference. `localizeDocument()` walks the DOM to translate text nodes and attributes.

`_locales/` only provides `manifest.json` strings (extension name, description) via Chrome's native i18n; all UI text goes through `src/shared/i18n.js`.

### Message Protocol

UI pages talk to the service worker through `chrome.runtime.sendMessage` with a `type` field:
- `SESSION_SET` — store key + start auto-lock
- `SESSION_TOUCH` — refresh expiry
- `SESSION_LOCK` — clear session
- `SESSION_STATUS` — check current state
- `QUICK_CAPTURE_BADGE_REFRESH` — update extension badge

### Data Flow (Unlock → Save)

1. User enters password → `unlockVaultRecord()` derives key via PBKDF2, decrypts auth sentinel to verify, decrypts bookmark array
2. Exported key (base64) sent to service worker via `SESSION_SET`, stored in `chrome.storage.session`
3. On save: `encryptBookmarksWithEncodedKey()` re-encrypts the full bookmark array → `saveVaultRecord()` writes to `chrome.storage.local`
4. On timeout or manual lock: service worker clears `chrome.storage.session`, UI resets

### Quick Capture (Locked State)

When the vault is locked, quick capture stores bookmarks **unencrypted** in `pendingQuickCaptures` in `chrome.storage.local`. On next unlock, `flushPendingQuickCaptures()` merges them into the encrypted vault and clears the pending store.

## Testing

Tests run in Node.js (not in a browser). They mock `globalThis.chrome` storage APIs where needed (`createChromeStorageMock` helper in the test file). The Web Crypto API is available natively in Node 20+.

## Key Conventions

- All data entering or leaving storage passes through `validation.js` normalize functions
- The `base64.js` module auto-detects Node `Buffer` vs browser `btoa`/`atob` for test compatibility
- Bookmark IDs are generated as `bm_{timestamp}_{random}`, not UUIDs
- Folder paths use `/` as separator, normalized by `normalizeFolderPath()` which trims and collapses slashes
- The vault record has a `version` field (currently `1`); `normalizeVaultRecord` rejects unknown versions
