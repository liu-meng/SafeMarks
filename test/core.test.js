import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { base64ToBytes, bytesToBase64 } from "../src/core/base64.js";
import {
  deriveKeyFromPassword,
  encryptJson,
  encryptString,
  exportKey,
  randomBytes
} from "../src/core/crypto.js";
import { AUTH_SENTINEL } from "../src/core/constants.js";
import {
  changeVaultPassword,
  decryptBookmarksWithEncodedKey,
  decryptVaultPayloadWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord,
  createBookmark,
  createVaultRecord
} from "../src/core/vault.js";
import { findRevisionHeadIds, mergeVaultPayloads } from "../src/core/sync-merge.js";
import {
  restoreVaultFromLocalFolder,
  syncLocalFolderNow
} from "../src/core/sync-coordinator.js";
import { loadSyncState, saveSyncState } from "../src/core/sync-storage.js";
import { getBookmarkSearchResults } from "../src/core/bookmark-search.js";
import {
  BACKUP_REMINDER_INTERVAL_MS,
  createRestorePreflight,
  getBackupReminderStatus,
  normalizeBackupReminderState
} from "../src/core/backup.js";
import {
  addTagsToBookmarks,
  deleteBookmarksByIds,
  moveBookmarksToFolder,
  removeTagsFromBookmarks
} from "../src/core/batch.js";
import { flattenNativeBookmarkTree } from "../src/core/native-bookmarks.js";
import { normalizeBookmarkTags } from "../src/core/tags.js";
import {
  addRecentFolderPath,
  MAX_RECENT_FOLDER_PATHS,
  normalizeRecentFolderPaths
} from "../src/core/recent-folders.js";
import {
  clearVaultRecord,
  hasVaultRecordData,
  loadBackupReminderState,
  loadFolderCatalog,
  loadPendingQuickCaptures,
  loadVaultRecord,
  saveBackupReminderState,
  savePendingQuickCaptures,
  saveVaultRecord
} from "../src/core/storage.js";
import {
  flushPendingQuickCaptures,
  queueCurrentPageQuickCapture,
  queueQuickCaptureBookmark
} from "../src/core/quick-capture.js";
import { createSessionRecord } from "../src/core/session.js";
import {
  getFolderCatalogFromBookmarks,
  removeFolderTreeFromBookmarks,
  renameFolderTreeInBookmarks,
  syncFolderCatalogFromBookmarks
} from "../src/core/folder-catalog.js";
import {
  normalizeAutoLockMinutes,
  normalizeVaultRecord
} from "../src/core/validation.js";
import {
  LANGUAGE_PREFERENCES,
  initializeI18n,
  localizeDocument,
  resolveLocaleFromPreference,
  setLanguagePreference,
  t
} from "../src/shared/i18n.js";
import { CHANGELOG } from "../src/shared/changelog.js";

test("base64 helpers round-trip bytes", () => {
  const source = new Uint8Array([0, 1, 2, 253, 254, 255]);
  const encoded = bytesToBase64(source);
  const decoded = base64ToBytes(encoded);

  assert.deepEqual([...decoded], [...source]);
});

test("options page exposes script-required shortcut controls", () => {
  const html = readFileSync(new URL("../src/options/index.html", import.meta.url), "utf8");

  assert.match(html, /id="open-shortcut-settings"/);
  assert.match(html, /id="shortcut-list"/);
  assert.match(html, /id="welcome-import-skip"/);
  assert.match(html, /id="welcome-complete-open-popup"/);
  assert.match(html, /id="welcome-complete-export-backup"/);
  assert.match(html, /id="backup-last-export"/);
  assert.match(html, /id="backup-reminder"/);
  assert.match(html, /id="backup-reminder-export"/);
  assert.match(html, /id="backup-reminder-dismiss"/);
  assert.match(html, /id="cloud-sync-connect"/);
  assert.match(html, /id="cloud-sync-now"/);
  assert.match(html, /id="cloud-sync-restore-form"/);
  assert.doesNotMatch(html, /(?:id|class|type|aria-live)=["“”][^"]*[“”]/);
});

test("popup page exposes compact recent list and shared folder picker targets", () => {
  const html = readFileSync(new URL("../src/popup/index.html", import.meta.url), "utf8");

  assert.match(html, /id="bookmark-list-title"/);
  assert.match(html, /id="bookmark-details"/);
  assert.match(html, /id="bookmark-folder-picker"/);
  assert.match(html, /id="bookmark-list"/);
});

test("quick capture page exposes shared folder picker target", () => {
  const html = readFileSync(new URL("../src/quick-capture/index.html", import.meta.url), "utf8");

  assert.match(html, /id="capture-folder-picker"/);
  assert.doesNotMatch(html, /id="existing-folder-select"/);
});

test("manager page exposes batch toolbar controls", () => {
  const html = readFileSync(new URL("../src/manager/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/manager/manager.js", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

  assert.match(html, /id="manager-sidebar"/);
  assert.match(html, /id="folder-tree"/);
  assert.match(html, /id="all-bookmarks-nav"/);
  assert.match(html, /id="search-nav"/);
  assert.match(html, /id="sidebar-settings"/);
  assert.match(html, /id="batch-toolbar"/);
  assert.match(html, /id="select-visible"/);
  assert.match(html, /id="batch-folder-path"/);
  assert.match(html, /id="batch-add-tags-field"/);
  assert.match(html, /id="batch-remove-tags-field"/);
  assert.match(html, /id="batch-delete"/);
  assert.match(script, /manager-folder-menu-button/);
  assert.match(script, /manager-folder-menu-item/);
  assert.ok(manifest.permissions.includes("favicon"));
});

test("tag normalization trims hashes deduplicates and limits values", () => {
  const tags = normalizeBookmarkTags([
    "  #Work  ",
    "work",
    "A   Long   Tag",
    "",
    "#".repeat(3),
    "x".repeat(40),
    ...Array.from({ length: 30 }, (_item, index) => `tag-${index}`)
  ]);

  assert.equal(tags[0], "Work");
  assert.equal(tags[1], "A Long Tag");
  assert.equal(tags[2], "x".repeat(32));
  assert.equal(tags.length, 20);
});

test("recent folder helpers normalize dedupe and keep newest paths first", () => {
  const normalized = normalizeRecentFolderPaths([
    " Work / API ",
    "",
    "work/api",
    "Personal",
    ...Array.from({ length: 20 }, (_item, index) => `Folder ${index}`)
  ]);

  assert.deepEqual(normalized.slice(0, 2), ["Work/API", "Personal"]);
  assert.equal(normalized.length, MAX_RECENT_FOLDER_PATHS);

  const next = addRecentFolderPath(normalized, " Personal ");
  assert.equal(next[0], "Personal");
  assert.equal(next.filter((path) => path.toLowerCase() === "personal").length, 1);
  assert.equal(next.length, MAX_RECENT_FOLDER_PATHS);
});

test("vault can be created and unlocked with the same password", async () => {
  const created = await createVaultRecord("super-secret", 15);
  const unlocked = await unlockVaultRecord(created.record, "super-secret");

  assert.equal(unlocked.record.version, 2);
  assert.match(unlocked.record.vaultId, /^vault_/);
  assert.ok(unlocked.record.kdf.iterations >= 100000);
  assert.equal(unlocked.record.meta.bookmarkCount, 0);
  assert.equal(unlocked.bookmarks.length, 0);
  assert.ok(unlocked.encodedKey.length > 10);
});

test("unlock rejects wrong password", async () => {
  const created = await createVaultRecord("correct-password", 15);

  await assert.rejects(
    () => unlockVaultRecord(created.record, "wrong-password"),
    /主密码不正确|Incorrect master password/
  );
});

test("auto language falls back to English when browser locale is unsupported", () => {
  assert.equal(
    resolveLocaleFromPreference(LANGUAGE_PREFERENCES.AUTO, "fr-FR"),
    LANGUAGE_PREFERENCES.ENGLISH
  );
  assert.equal(
    resolveLocaleFromPreference(LANGUAGE_PREFERENCES.AUTO, "zh-TW"),
    LANGUAGE_PREFERENCES.CHINESE
  );
  assert.equal(
    resolveLocaleFromPreference(LANGUAGE_PREFERENCES.AUTO, "ja-JP"),
    LANGUAGE_PREFERENCES.JAPANESE
  );
});

test("i18n initialization supports promise-style storage APIs", async () => {
  const originalChrome = globalThis.chrome;
  const storageState = {
    languagePreference: LANGUAGE_PREFERENCES.CHINESE
  };

  globalThis.chrome = {
    runtime: {
      lastError: null
    },
    i18n: {
      getUILanguage: () => "en-US"
    },
    storage: {
      local: {
        get(key) {
          return Promise.resolve({
            [key]: storageState[key]
          });
        },
        set(value) {
          Object.assign(storageState, value);
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener() {}
      }
    }
  };

  try {
    const locale = await Promise.race([
      initializeI18n({ force: true }),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("initializeI18n timed out")), 200);
      })
    ]);

    assert.equal(locale, LANGUAGE_PREFERENCES.CHINESE);

    const savedLocale = await setLanguagePreference(LANGUAGE_PREFERENCES.ENGLISH);
    assert.equal(savedLocale, LANGUAGE_PREFERENCES.ENGLISH);
    assert.equal(storageState.languagePreference, LANGUAGE_PREFERENCES.ENGLISH);
  } finally {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
  }
});

test("localizeDocument reveals the page only after localization is applied", async () => {
  const originalNodeFilter = globalThis.NodeFilter;
  globalThis.NodeFilter = {
    SHOW_TEXT: 4,
    FILTER_REJECT: 2,
    FILTER_ACCEPT: 1
  };

  const documentElement = {
    attributes: new Map([["data-i18n-pending", "true"]]),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
  };

  const fakeRoot = {
    documentElement,
    title: "",
    body: {},
    querySelectorAll() {
      return [];
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        }
      };
    }
  };

  try {
    await setLanguagePreference(LANGUAGE_PREFERENCES.ENGLISH);
    localizeDocument(fakeRoot);
    assert.equal(documentElement.getAttribute("lang"), LANGUAGE_PREFERENCES.ENGLISH);
    assert.equal(documentElement.getAttribute("data-i18n-pending"), null);
  } finally {
    globalThis.NodeFilter = originalNodeFilter;
  }
});

test("every changelog entry has an English translation", async () => {
  await setLanguagePreference(LANGUAGE_PREFERENCES.ENGLISH);

  for (const release of CHANGELOG) {
    for (const change of release.changes) {
      assert.notEqual(t(change), change, `Missing English changelog translation: ${change}`);
    }
  }
});

test("every changelog entry has a Japanese translation", async () => {
  await setLanguagePreference(LANGUAGE_PREFERENCES.JAPANESE);

  for (const release of CHANGELOG) {
    for (const change of release.changes) {
      assert.notEqual(t(change), change, `Missing Japanese changelog translation: ${change}`);
    }
  }
});

test("bookmark payload stays encrypted round-trip with encoded key", async () => {
  const created = await createVaultRecord("vault-pass", 5);
  const unlocked = await unlockVaultRecord(created.record, "vault-pass");
  const nextRecord = await encryptBookmarksWithEncodedKey(
    created.record,
    [
      {
        id: "bm_1",
        url: "https://example.com/docs",
        title: "Example Docs",
        folderPath: "Work/Docs",
        tags: [],
        createdAt: 1710000000000
      }
    ],
    unlocked.encodedKey
  );
  const bookmarks = await decryptBookmarksWithEncodedKey(
    nextRecord,
    unlocked.encodedKey
  );

  assert.equal(nextRecord.meta.bookmarkCount, 1);
  assert.equal(bookmarks[0].title, "Example Docs");
  assert.equal(bookmarks[0].url, "https://example.com/docs");
  assert.equal(bookmarks[0].folderPath, "Work/Docs");
  assert.equal(bookmarks[0].note, "");
});

test("bookmark note stays encrypted round-trip with encoded key", async () => {
  const created = await createVaultRecord("vault-pass", 5);
  const unlocked = await unlockVaultRecord(created.record, "vault-pass");
  const nextRecord = await encryptBookmarksWithEncodedKey(
    created.record,
    [
      {
        id: "bm_2",
        url: "https://example.com/guide",
        title: "Example Guide",
        note: "Read this before deployment",
        tags: [],
        createdAt: 1710000000001
      }
    ],
    unlocked.encodedKey
  );
  const bookmarks = await decryptBookmarksWithEncodedKey(
    nextRecord,
    unlocked.encodedKey
  );

  assert.equal(bookmarks[0].note, "Read this before deployment");
});

test("bookmark tags stay encrypted round-trip with encoded key", async () => {
  const created = await createVaultRecord("vault-pass", 5);
  const unlocked = await unlockVaultRecord(created.record, "vault-pass");
  const nextRecord = await encryptBookmarksWithEncodedKey(
    created.record,
    [
      createBookmark({
        id: "bm_4",
        url: "https://example.com/tagged",
        title: "Tagged Bookmark",
        note: "",
        folderPath: "",
        tags: ["#Work", "work", "Read Later"],
        createdAt: 1710000000003
      })
    ],
    unlocked.encodedKey
  );
  const bookmarks = await decryptBookmarksWithEncodedKey(
    nextRecord,
    unlocked.encodedKey
  );

  assert.deepEqual(bookmarks[0].tags, ["Work", "Read Later"]);
});

test("bookmark validation keeps legacy items compatible without folder path", async () => {
  const created = await createVaultRecord("vault-pass", 5);
  const unlocked = await unlockVaultRecord(created.record, "vault-pass");
  const nextRecord = await encryptBookmarksWithEncodedKey(
    created.record,
    [
      {
        id: "bm_3",
        url: "https://example.com/legacy",
        title: "Legacy Bookmark",
        tags: [],
        createdAt: 1710000000002
      }
    ],
    unlocked.encodedKey
  );
  const bookmarks = await decryptBookmarksWithEncodedKey(
    nextRecord,
    unlocked.encodedKey
  );

  assert.equal(bookmarks[0].folderPath, "");
});

test("vault V2 tracks edits and deletion tombstones inside ciphertext", async () => {
  const created = await createVaultRecord("vault-pass", 15);
  const first = createBookmark({
    title: "First",
    url: "https://example.com/first",
    createdAt: 1710000000000
  });
  const second = createBookmark({
    title: "Second",
    url: "https://example.com/second",
    createdAt: 1710000000001
  });
  const populated = await encryptBookmarksWithEncodedKey(
    created.record,
    [first, second],
    created.encodedKey
  );
  const updated = await encryptBookmarksWithEncodedKey(
    populated,
    [{ ...first, title: "First updated" }],
    created.encodedKey
  );
  const payload = await decryptVaultPayloadWithEncodedKey(updated, created.encodedKey);

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.bookmarks.length, 1);
  assert.equal(payload.bookmarks[0].title, "First updated");
  assert.ok(payload.bookmarks[0].updatedAt >= first.updatedAt);
  assert.deepEqual(payload.tombstones.map((item) => item.id), [second.id]);
  assert.doesNotMatch(updated.vault.ciphertext, /First updated|example\.com/);
});

test("three-way sync merge preserves independent edits and creates conflict copies", () => {
  const baseBookmark = {
    id: "bm_shared",
    title: "Base",
    url: "https://example.com",
    note: "",
    folderPath: "",
    tags: [],
    createdAt: 1710000000000,
    updatedAt: 1710000000000
  };
  const addedLocal = { ...baseBookmark, id: "bm_local", title: "Local", updatedAt: 1710000000001 };
  const addedRemote = { ...baseBookmark, id: "bm_remote", title: "Remote", updatedAt: 1710000000002 };
  const merged = mergeVaultPayloads({
    base: { schemaVersion: 2, bookmarks: [baseBookmark], tombstones: [] },
    local: {
      schemaVersion: 2,
      bookmarks: [{ ...baseBookmark, title: "Local edit", updatedAt: 1710000000010 }, addedLocal],
      tombstones: []
    },
    remote: {
      schemaVersion: 2,
      bookmarks: [{ ...baseBookmark, title: "Remote edit", updatedAt: 1710000000020 }, addedRemote],
      tombstones: []
    },
    createId: () => "bm_conflict"
  });

  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(
    merged.payload.bookmarks.map((bookmark) => bookmark.id).sort(),
    ["bm_conflict", "bm_local", "bm_remote", "bm_shared"]
  );
  assert.equal(
    merged.payload.bookmarks.find((bookmark) => bookmark.id === "bm_conflict").title,
    "Remote edit（同步冲突副本）"
  );
});

test("revision head detection supports divergent and merged histories", () => {
  const revisions = [
    { revisionId: "a", parentRevisionIds: [] },
    { revisionId: "b", parentRevisionIds: ["a"] },
    { revisionId: "c", parentRevisionIds: ["a"] }
  ];
  assert.deepEqual(findRevisionHeadIds(revisions).sort(), ["b", "c"]);
  revisions.push({ revisionId: "d", parentRevisionIds: ["b", "c"] });
  assert.deepEqual(findRevisionHeadIds(revisions), ["d"]);
});

test("vault validation rejects unsupported version", () => {
  assert.throws(
    () =>
      normalizeVaultRecord({
        version: 3,
        salt: "abc",
        auth: { iv: "a", ciphertext: "b" },
        vault: { iv: "c", ciphertext: "d" },
        settings: { autoLockMinutes: 15 }
      }),
    /Unsupported vault version/
  );
});

test("vault validation accepts legacy records without bookmark count metadata", () => {
  const normalized = normalizeVaultRecord({
    version: 1,
    salt: "abc",
    auth: { iv: "a", ciphertext: "b" },
    vault: { iv: "c", ciphertext: "d" },
    settings: { autoLockMinutes: 15 }
  });

  assert.equal(normalized.meta.bookmarkCount, null);
});

test("legacy V1 vault unlocks and migrates to V2 on the next encrypted write", async () => {
  const saltBytes = randomBytes(16);
  const key = await deriveKeyFromPassword("legacy-pass", saltBytes, 100000);
  const legacyBookmark = {
    id: "bm_legacy",
    title: "Legacy",
    url: "https://example.com/legacy",
    note: "",
    folderPath: "",
    tags: [],
    createdAt: 1710000000000
  };
  const legacyRecord = {
    version: 1,
    salt: bytesToBase64(saltBytes),
    auth: await encryptString(AUTH_SENTINEL, key),
    vault: await encryptJson([legacyBookmark], key),
    settings: { autoLockMinutes: 15, passwordHint: "" },
    meta: { bookmarkCount: 1 }
  };
  const unlocked = await unlockVaultRecord(legacyRecord, "legacy-pass");
  const migrated = await encryptBookmarksWithEncodedKey(
    legacyRecord,
    unlocked.bookmarks,
    await exportKey(key)
  );

  assert.equal(unlocked.bookmarks[0].updatedAt, legacyBookmark.createdAt);
  assert.equal(migrated.version, 2);
  assert.match(migrated.vaultId, /^vault_/);
  assert.equal((await decryptBookmarksWithEncodedKey(migrated, unlocked.encodedKey)).length, 1);
});

test("auto-lock supports 1 minute and falls back to the new 15 minute default", () => {
  assert.equal(normalizeAutoLockMinutes(1), 1);
  assert.equal(normalizeAutoLockMinutes(999), 15);
});

test("session creation uses the 15 minute default when auto-lock is omitted", () => {
  const session = createSessionRecord({
    encodedKey: "encoded-key",
    now: 1_000
  });

  assert.equal(session.autoLockMinutes, 15);
  assert.equal(session.lastActivityAt, 1_000);
  assert.equal(session.expiresAt, 901_000);
});

test("vault presence detection treats legacy or partial vault data as initialized", () => {
  assert.equal(hasVaultRecordData(null), false);
  assert.equal(hasVaultRecordData({}), false);
  assert.equal(hasVaultRecordData({ version: 1 }), true);
  assert.equal(
    hasVaultRecordData({
      version: 1,
      salt: "abc",
      auth: { iv: "a", ciphertext: "b" },
      vault: { iv: "c", ciphertext: "d" }
    }),
    true
  );
});

test("native import keeps root category and nested folders", () => {
  const { bookmarks, skippedCount } = flattenNativeBookmarkTree([
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          parentId: "0",
          title: "Bookmarks Bar",
          children: [
            {
              id: "2",
              parentId: "1",
              title: "Top Link",
              url: "https://example.com/top",
              dateAdded: 1710000000000
            },
            {
              id: "3",
              parentId: "1",
              title: "Work",
              children: [
                {
                  id: "4",
                  parentId: "3",
                  title: "Docs",
                  children: [
                    {
                      id: "5",
                      parentId: "4",
                      title: "Guide",
                      url: "https://example.com/guide",
                      dateAdded: 1710000000100
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]);

  assert.equal(skippedCount, 0);
  assert.equal(bookmarks.length, 2);
  assert.deepEqual(
    bookmarks.map((bookmark) => ({
      title: bookmark.title,
      folderPath: bookmark.folderPath,
      createdAt: bookmark.createdAt
    })),
    [
      {
        title: "Top Link",
        folderPath: "Bookmarks Bar",
        createdAt: 1710000000000
      },
      {
        title: "Guide",
        folderPath: "Bookmarks Bar/Work/Docs",
        createdAt: 1710000000100
      }
    ]
  );
});

test("native import keeps top-level bookmarks inside their native category", () => {
  const { bookmarks } = flattenNativeBookmarkTree([
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          parentId: "0",
          title: "Other Bookmarks",
          children: [
            {
              id: "2",
              parentId: "1",
              title: "Site",
              url: "https://example.com/site",
              dateAdded: 1710000000200
            }
          ]
        }
      ]
    }
  ]);

  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].folderPath, "Other Bookmarks");
  assert.equal(bookmarks[0].createdAt, 1710000000200);
});

test("native import skips unsupported urls without stopping", () => {
  const { bookmarks, skippedCount } = flattenNativeBookmarkTree([
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          parentId: "0",
          title: "Other Bookmarks",
          children: [
            {
              id: "2",
              parentId: "1",
              title: "Internal",
              url: "chrome://extensions"
            },
            {
              id: "3",
              parentId: "1",
              title: "Site",
              url: "https://example.com/site"
            }
          ]
        }
      ]
    }
  ]);

  assert.equal(skippedCount, 1);
  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].title, "Site");
  assert.equal(bookmarks[0].folderPath, "Other Bookmarks");
});

test("native import falls back to current timestamp when dateAdded is missing", () => {
  const { bookmarks } = flattenNativeBookmarkTree([
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          parentId: "0",
          title: "Mobile Bookmarks",
          children: [
            {
              id: "2",
              parentId: "1",
              title: "",
              url: "https://example.com/mobile"
            }
          ]
        }
      ]
    }
  ], 1710000000999);

  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].title, "https://example.com/mobile");
  assert.equal(bookmarks[0].createdAt, 1710000000999);
});

test("native import ignores empty folder names but keeps descendants", () => {
  const { bookmarks, skippedCount } = flattenNativeBookmarkTree([
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          parentId: "0",
          title: "Bookmarks Bar",
          children: [
            {
              id: "2",
              parentId: "1",
              title: "   ",
              children: [
                {
                  id: "3",
                  parentId: "2",
                  title: "Nested",
                  url: "https://example.com/nested"
                }
              ]
            }
          ]
        }
      ]
    }
  ], 1710000000222);

  assert.equal(skippedCount, 0);
  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].folderPath, "Bookmarks Bar");
  assert.equal(bookmarks[0].createdAt, 1710000000222);
});

test("bookmark search matches note content", () => {
  const results = getBookmarkSearchResults(
    [
      {
        id: "bm_1",
        title: "Docs",
        url: "https://example.com/docs",
        folderPath: "Work",
        note: "Read this before deployment",
        createdAt: 1710000000000
      },
      {
        id: "bm_2",
        title: "Home",
        url: "https://example.com/home",
        folderPath: "Personal",
        note: "",
        createdAt: 1710000000100
      }
    ],
    "deployment"
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "bm_1");
});

test("bookmark search returns all results when query is empty", () => {
  const results = getBookmarkSearchResults(
    [
      {
        id: "bm_1",
        title: "Older",
        url: "https://example.com/older",
        folderPath: "",
        note: "",
        createdAt: 1710000000000
      },
      {
        id: "bm_2",
        title: "Newer",
        url: "https://example.com/newer",
        folderPath: "",
        note: "",
        createdAt: 1710000000100
      }
    ],
    ""
  );

  assert.equal(results.length, 2);
});

test("bookmark search is case insensitive", () => {
  const results = getBookmarkSearchResults(
    [
      {
        id: "bm_1",
        title: "RFC",
        url: "https://example.com/spec",
        folderPath: "Work/API",
        note: "",
        createdAt: 1710000000000
      }
    ],
    "api"
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "bm_1");
});

test("bookmark search keeps newest bookmarks first", () => {
  const results = getBookmarkSearchResults(
    [
      {
        id: "bm_1",
        title: "Old",
        url: "https://example.com/old",
        folderPath: "",
        note: "",
        createdAt: 1710000000000
      },
      {
        id: "bm_2",
        title: "New",
        url: "https://example.com/new",
        folderPath: "",
        note: "",
        createdAt: 1710000000200
      },
      {
        id: "bm_3",
        title: "Mid",
        url: "https://example.com/mid",
        folderPath: "",
        note: "",
        createdAt: 1710000000100
      }
    ]
  );

  assert.deepEqual(
    results.map((bookmark) => bookmark.id),
    ["bm_2", "bm_3", "bm_1"]
  );
});

test("bookmark search matches tags and fuzzy title text", () => {
  const results = getBookmarkSearchResults(
    [
      {
        id: "bm_1",
        title: "Production Incident Review",
        url: "https://example.com/prod",
        folderPath: "Work",
        note: "",
        tags: ["Postmortem"],
        createdAt: 1710000000000
      },
      {
        id: "bm_2",
        title: "Home",
        url: "https://example.com/home",
        folderPath: "Personal",
        note: "",
        tags: ["Read Later"],
        createdAt: 1710000000100
      }
    ],
    "pdir"
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "bm_1");

  const tagResults = getBookmarkSearchResults(results.concat([
    {
      id: "bm_3",
      title: "Notes",
      url: "https://example.com/notes",
      folderPath: "",
      note: "",
      tags: ["Security"],
      createdAt: 1710000000200
    }
  ]), "security");

  assert.equal(tagResults[0].id, "bm_3");
});

test("bookmark search prioritizes title and tag matches before older lower weighted fields", () => {
  const results = getBookmarkSearchResults(
    [
      {
        id: "bm_old_url",
        title: "Reference",
        url: "https://example.com/security",
        folderPath: "",
        note: "",
        tags: [],
        createdAt: 1710000000300
      },
      {
        id: "bm_tag",
        title: "Checklist",
        url: "https://example.com/check",
        folderPath: "",
        note: "",
        tags: ["Security"],
        createdAt: 1710000000000
      },
      {
        id: "bm_title",
        title: "Security Guide",
        url: "https://example.com/guide",
        folderPath: "",
        note: "",
        tags: [],
        createdAt: 1710000000100
      }
    ],
    "security"
  );

  assert.deepEqual(
    results.map((bookmark) => bookmark.id),
    ["bm_title", "bm_tag", "bm_old_url"]
  );
});

function createChromeStorageMock(initialLocal = {}, tabs = []) {
  const localStore = { ...initialLocal };
  const sessionStore = {};

  function normalizeKeys(keys) {
    return Array.isArray(keys) ? keys : [keys];
  }

  return {
    chrome: {
      storage: {
        local: {
          async get(keys) {
            const result = {};
            for (const key of normalizeKeys(keys)) {
              result[key] = localStore[key];
            }
            return result;
          },
          async set(values) {
            Object.assign(localStore, values);
          },
          async remove(keys) {
            for (const key of normalizeKeys(keys)) {
              delete localStore[key];
            }
          }
        },
        session: {
          async get(key) {
            return {
              [key]: sessionStore[key]
            };
          },
          async set(values) {
            Object.assign(sessionStore, values);
          },
          async remove(key) {
            delete sessionStore[key];
          }
        }
      },
      tabs: {
        async query() {
          return tabs;
        }
      }
    }
  };
}

test("backup reminder state normalizes and becomes due after the reminder interval", () => {
  const now = 1710000000000;

  assert.deepEqual(
    normalizeBackupReminderState({
      lastEncryptedExportAt: "bad",
      dismissedAt: -1
    }),
    {
      lastEncryptedExportAt: null,
      dismissedAt: null
    }
  );

  assert.equal(
    getBackupReminderStatus({
      hasVault: false,
      bookmarkCount: 10,
      reminderState: null,
      now
    }).shouldShow,
    false
  );
  assert.equal(
    getBackupReminderStatus({
      hasVault: true,
      bookmarkCount: 0,
      reminderState: null,
      now
    }).shouldShow,
    false
  );
  assert.equal(
    getBackupReminderStatus({
      hasVault: true,
      bookmarkCount: 1,
      reminderState: null,
      now
    }).reason,
    "never-exported"
  );
  assert.equal(
    getBackupReminderStatus({
      hasVault: true,
      bookmarkCount: 1,
      reminderState: {
        lastEncryptedExportAt: now - BACKUP_REMINDER_INTERVAL_MS + 1
      },
      now
    }).shouldShow,
    false
  );
  assert.equal(
    getBackupReminderStatus({
      hasVault: true,
      bookmarkCount: 1,
      reminderState: {
        lastEncryptedExportAt: now - BACKUP_REMINDER_INTERVAL_MS
      },
      now
    }).reason,
    "stale-export"
  );
  assert.equal(
    getBackupReminderStatus({
      hasVault: true,
      bookmarkCount: 1,
      reminderState: {
        dismissedAt: now - 100
      },
      now
    }).shouldShow,
    false
  );
});

test("restore preflight validates encrypted vault metadata", async () => {
  const created = await createVaultRecord("vault-pass", 0, "hint");
  const preflight = createRestorePreflight(created.record, {
    hasExistingVault: true
  });

  assert.equal(preflight.record.version, 2);
  assert.equal(preflight.hasExistingVault, true);
  assert.equal(preflight.version, 2);
  assert.equal(preflight.bookmarkCount, 0);
  assert.equal(preflight.autoLockMinutes, 0);
  assert.equal(preflight.hasPasswordHint, true);
  assert.throws(
    () => createRestorePreflight({ version: 999 }),
    /不是有效的 SafeMarks 加密备份|not a valid SafeMarks encrypted backup/
  );
});

test("backup reminder state persists through local storage and is cleared with vault data", async () => {
  const originalChrome = globalThis.chrome;
  const { chrome } = createChromeStorageMock();

  globalThis.chrome = chrome;

  try {
    await saveBackupReminderState({
      lastEncryptedExportAt: 1710000000000,
      dismissedAt: 1710000001000
    });

    assert.deepEqual(await loadBackupReminderState(), {
      lastEncryptedExportAt: 1710000000000,
      dismissedAt: 1710000001000
    });

    await clearVaultRecord();

    assert.deepEqual(await loadBackupReminderState(), {
      lastEncryptedExportAt: null,
      dismissedAt: null
    });
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("quick capture can queue current page without unlock", async () => {
  const originalChrome = globalThis.chrome;
  const { chrome } = createChromeStorageMock({}, [
    {
      id: 1,
      title: "Queued Page",
      url: "https://example.com/queued"
    }
  ]);

  globalThis.chrome = chrome;

  try {
    const result = await queueCurrentPageQuickCapture();
    const pending = await loadPendingQuickCaptures();

    assert.equal(result.pendingCount, 1);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].title, "Queued Page");
    assert.equal(pending[0].url, "https://example.com/queued");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("folder catalog deduplicates and sorts existing folder paths", () => {
  const catalog = getFolderCatalogFromBookmarks([
    createBookmark({
      title: "A",
      url: "https://example.com/a",
      folderPath: "Work/API"
    }),
    createBookmark({
      title: "B",
      url: "https://example.com/b",
      folderPath: " Work / API "
    }),
    createBookmark({
      title: "C",
      url: "https://example.com/c",
      folderPath: "Personal"
    }),
    createBookmark({
      title: "D",
      url: "https://example.com/d"
    })
  ]);

  assert.deepEqual(catalog, ["Personal", "Work/API"]);
});

test("removeFolderTreeFromBookmarks deletes a top-level folder and all descendants", () => {
  const bookmarks = [
    { id: "1", folderPath: "Work" },
    { id: "2", folderPath: "Work/API" },
    { id: "3", folderPath: "Work/API/Auth" },
    { id: "4", folderPath: "Personal" },
    { id: "5", folderPath: "" }
  ];

  const result = removeFolderTreeFromBookmarks(bookmarks, "Work");

  assert.equal(result.removedCount, 3);
  assert.deepEqual(
    result.nextBookmarks.map((bookmark) => bookmark.id),
    ["4", "5"]
  );
});

test("removeFolderTreeFromBookmarks deletes only the targeted nested subtree", () => {
  const bookmarks = [
    { id: "1", folderPath: "Work" },
    { id: "2", folderPath: "Work/API" },
    { id: "3", folderPath: "Work/API/Auth" },
    { id: "4", folderPath: "Work/Docs" },
    { id: "5", folderPath: "Personal" }
  ];

  const result = removeFolderTreeFromBookmarks(bookmarks, "Work/API");

  assert.equal(result.removedCount, 2);
  assert.deepEqual(
    result.nextBookmarks.map((bookmark) => bookmark.id),
    ["1", "4", "5"]
  );
});

test("removeFolderTreeFromBookmarks respects folder path boundaries", () => {
  const bookmarks = [
    { id: "1", folderPath: "Work" },
    { id: "2", folderPath: "Workshop" },
    { id: "3", folderPath: "Work/Docs" }
  ];

  const result = removeFolderTreeFromBookmarks(bookmarks, "Work");

  assert.equal(result.removedCount, 2);
  assert.deepEqual(
    result.nextBookmarks.map((bookmark) => bookmark.id),
    ["2"]
  );
});

test("renameFolderTreeInBookmarks renames a folder and descendants", () => {
  const bookmarks = [
    { id: "1", folderPath: "Work" },
    { id: "2", folderPath: "Work/API" },
    { id: "3", folderPath: "Work/API/Auth" },
    { id: "4", folderPath: "Workshop" },
    { id: "5", folderPath: "" }
  ];

  const result = renameFolderTreeInBookmarks(bookmarks, " Work ", " Team ");

  assert.equal(result.conflict, false);
  assert.equal(result.renamedCount, 3);
  assert.deepEqual(result.nextBookmarks.map((bookmark) => bookmark.folderPath), [
    "Team",
    "Team/API",
    "Team/API/Auth",
    "Workshop",
    ""
  ]);
});

test("renameFolderTreeInBookmarks blocks existing target folders", () => {
  const bookmarks = [
    { id: "1", folderPath: "Work" },
    { id: "2", folderPath: "Work/API" },
    { id: "3", folderPath: "Team" }
  ];

  const result = renameFolderTreeInBookmarks(bookmarks, "Work", "Team");

  assert.equal(result.conflict, true);
  assert.equal(result.renamedCount, 0);
  assert.deepEqual(result.nextBookmarks, bookmarks);
});

test("batch helpers move tag and delete only selected bookmarks", () => {
  const bookmarks = [
    {
      id: "1",
      title: "A",
      url: "https://example.com/a",
      folderPath: "Old",
      note: "",
      tags: ["Keep"],
      createdAt: 1710000000000
    },
    {
      id: "2",
      title: "B",
      url: "https://example.com/b",
      folderPath: "Old",
      note: "",
      tags: ["Work"],
      createdAt: 1710000000001
    },
    {
      id: "3",
      title: "C",
      url: "https://example.com/c",
      folderPath: "Other",
      note: "",
      tags: [],
      createdAt: 1710000000002
    }
  ];

  const moved = moveBookmarksToFolder(bookmarks, ["1", "2"], " New / Folder ");
  assert.deepEqual(moved.map((bookmark) => bookmark.folderPath), ["New/Folder", "New/Folder", "Other"]);

  const withTags = addTagsToBookmarks(moved, ["1", "2"], ["#Work", "Later"]);
  assert.deepEqual(withTags[0].tags, ["Keep", "Work", "Later"]);
  assert.deepEqual(withTags[1].tags, ["Work", "Later"]);
  assert.deepEqual(withTags[2].tags, []);

  const withoutTags = removeTagsFromBookmarks(withTags, ["1", "3"], ["work"]);
  assert.deepEqual(withoutTags[0].tags, ["Keep", "Later"]);
  assert.deepEqual(withoutTags[1].tags, ["Work", "Later"]);

  const deleted = deleteBookmarksByIds(withoutTags, ["2"]);
  assert.deepEqual(deleted.map((bookmark) => bookmark.id), ["1", "3"]);
});

test("queued quick capture adds its folder path into folder catalog", async () => {
  const originalChrome = globalThis.chrome;
  const { chrome } = createChromeStorageMock();

  globalThis.chrome = chrome;

  try {
    await syncFolderCatalogFromBookmarks([
      createBookmark({
        title: "Existing",
        url: "https://example.com/existing",
        folderPath: "Work"
      })
    ]);
    await queueQuickCaptureBookmark(createBookmark({
      title: "Queued",
      url: "https://example.com/queued",
      folderPath: "Work/ProjectA"
    }));

    const catalog = await loadFolderCatalog();

    assert.deepEqual(catalog, ["Work", "Work/ProjectA"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("pending quick captures are merged into the vault after unlock", async () => {
  const originalChrome = globalThis.chrome;
  const { chrome } = createChromeStorageMock();

  globalThis.chrome = chrome;

  try {
    const created = await createVaultRecord("vault-pass", 15);
    await saveVaultRecord(created.record);
    await savePendingQuickCaptures([
      createBookmark({
        title: "Queued Page",
        url: "https://example.com/queued",
        folderPath: "Inbox",
        createdAt: 1710000000002
      })
    ]);

    const flushed = await flushPendingQuickCaptures({
      record: created.record,
      encodedKey: created.encodedKey,
      currentBookmarks: [
        createBookmark({
          title: "Existing Page",
          url: "https://example.com/existing",
          folderPath: "Work",
          createdAt: 1710000000001
        })
      ]
    });

    const catalog = await loadFolderCatalog();
    const pending = await loadPendingQuickCaptures();

    assert.equal(flushed.importedCount, 1);
    assert.equal(flushed.bookmarks.length, 2);
    assert.equal(flushed.bookmarks[0].title, "Queued Page");
    assert.equal(flushed.bookmarks[1].title, "Existing Page");
    assert.deepEqual(catalog, ["Inbox", "Work"]);
    assert.deepEqual(pending, []);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("vault password can be changed and unlocked with new password", async () => {
  const created = await createVaultRecord("old-pass", 15);
  const bookmarks = [
    { id: "bm_1", url: "https://example.com", title: "Test", folderPath: "", note: "", tags: [], createdAt: 1710000000000 }
  ];
  const withBookmarks = await encryptBookmarksWithEncodedKey(created.record, bookmarks, created.encodedKey);

  const changed = await changeVaultPassword(withBookmarks, "old-pass", "new-pass");
  const unlocked = await unlockVaultRecord(changed.record, "new-pass");

  assert.equal(unlocked.bookmarks.length, 1);
  assert.equal(unlocked.bookmarks[0].title, "Test");
});

test("vault password change rejects wrong current password", async () => {
  const created = await createVaultRecord("correct", 15);

  await assert.rejects(
    () => changeVaultPassword(created.record, "wrong", "new-pass"),
    /主密码不正确|Incorrect master password/
  );
});

test("vault password change generates new salt", async () => {
  const created = await createVaultRecord("old-pass", 15);
  const changed = await changeVaultPassword(created.record, "old-pass", "new-pass");

  assert.notEqual(changed.record.salt, created.record.salt);
});

test("folder sync writes an encrypted revision and restores it on another device", async () => {
  const originalChrome = globalThis.chrome;
  const remoteRevisions = [];
  const provider = {
    async listRevisions() {
      return remoteRevisions;
    },
    async writeRevision(revision) {
      const index = remoteRevisions.findIndex((item) => item.revisionId === revision.revisionId);
      if (index >= 0) remoteRevisions[index] = revision;
      else remoteRevisions.push(revision);
    },
    async writeManifest() {}
  };

  try {
    const firstDevice = createChromeStorageMock();
    globalThis.chrome = firstDevice.chrome;
    const created = await createVaultRecord("sync-pass", 15);
    const bookmark = createBookmark({
      title: "Synced page",
      url: "https://example.com/synced"
    });
    const populated = await encryptBookmarksWithEncodedKey(
      created.record,
      [bookmark],
      created.encodedKey
    );
    await saveVaultRecord(populated);
    await saveSyncState({
      enabled: true,
      provider: "local-folder",
      directoryName: "SafeMarks",
      status: "ready"
    });

    await syncLocalFolderNow({ encodedKey: created.encodedKey, provider });
    assert.equal(remoteRevisions.length, 1);
    assert.doesNotMatch(JSON.stringify(remoteRevisions), /Synced page|example\.com\/synced/);

    const changedPassword = await changeVaultPassword(populated, "sync-pass", "new-sync-pass");
    await saveVaultRecord(changedPassword.record);
    await syncLocalFolderNow({ encodedKey: changedPassword.encodedKey, provider });
    assert.equal(remoteRevisions.length, 2);

    const secondDevice = createChromeStorageMock();
    globalThis.chrome = secondDevice.chrome;
    const restored = await restoreVaultFromLocalFolder({ password: "new-sync-pass", provider });
    const bookmarks = await decryptBookmarksWithEncodedKey(restored.record, restored.encodedKey);

    assert.equal(bookmarks.length, 1);
    assert.equal(bookmarks[0].title, "Synced page");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("two devices preserve independent offline additions and converge to one head", async () => {
  const originalChrome = globalThis.chrome;
  const remoteRevisions = [];
  const provider = {
    async listRevisions() {
      return remoteRevisions;
    },
    async writeRevision(revision) {
      remoteRevisions.push(revision);
    },
    async writeManifest() {}
  };
  const deviceOne = createChromeStorageMock();
  const deviceTwo = createChromeStorageMock();

  try {
    globalThis.chrome = deviceOne.chrome;
    const created = await createVaultRecord("shared-pass", 15);
    await saveVaultRecord(created.record);
    await saveSyncState({ enabled: true, provider: "local-folder", status: "ready" });
    await syncLocalFolderNow({ encodedKey: created.encodedKey, provider });

    globalThis.chrome = deviceTwo.chrome;
    const restored = await restoreVaultFromLocalFolder({ password: "shared-pass", provider });

    globalThis.chrome = deviceOne.chrome;
    let record = await loadVaultRecord();
    record = await encryptBookmarksWithEncodedKey(record, [
      createBookmark({ title: "From Mac One", url: "https://example.com/mac-one" })
    ], created.encodedKey);
    await saveVaultRecord(record);
    await syncLocalFolderNow({ encodedKey: created.encodedKey, provider });

    globalThis.chrome = deviceTwo.chrome;
    record = await loadVaultRecord();
    record = await encryptBookmarksWithEncodedKey(record, [
      createBookmark({ title: "From Mac Two", url: "https://example.com/mac-two" })
    ], restored.encodedKey);
    await saveVaultRecord(record);
    await syncLocalFolderNow({ encodedKey: restored.encodedKey, provider });

    const converged = await decryptBookmarksWithEncodedKey(await loadVaultRecord(), restored.encodedKey);
    assert.deepEqual(
      converged.map((bookmark) => bookmark.title).sort(),
      ["From Mac One", "From Mac Two"]
    );
    assert.equal(findRevisionHeadIds(remoteRevisions).length, 1);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("an old device detects a master-password change without overwriting remote data", async () => {
  const originalChrome = globalThis.chrome;
  const remoteRevisions = [];
  const provider = {
    async listRevisions() { return remoteRevisions; },
    async writeRevision(revision) { remoteRevisions.push(revision); },
    async writeManifest() {}
  };
  const deviceOne = createChromeStorageMock();
  const deviceTwo = createChromeStorageMock();

  try {
    globalThis.chrome = deviceOne.chrome;
    const created = await createVaultRecord("old-pass", 15);
    await saveVaultRecord(created.record);
    await saveSyncState({ enabled: true, provider: "local-folder", status: "ready" });
    await syncLocalFolderNow({ encodedKey: created.encodedKey, provider });

    globalThis.chrome = deviceTwo.chrome;
    const restored = await restoreVaultFromLocalFolder({ password: "old-pass", provider });

    globalThis.chrome = deviceOne.chrome;
    const changed = await changeVaultPassword(await loadVaultRecord(), "old-pass", "new-pass");
    await saveVaultRecord(changed.record);
    await syncLocalFolderNow({ encodedKey: changed.encodedKey, provider });

    globalThis.chrome = deviceTwo.chrome;
    await assert.rejects(
      () => syncLocalFolderNow({ encodedKey: restored.encodedKey, provider }),
      /主密码已更改/
    );
    assert.equal((await loadSyncState()).status, "remote-password-changed");
    assert.equal(findRevisionHeadIds(remoteRevisions).length, 1);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
