import test from "node:test";
import assert from "node:assert/strict";

import { base64ToBytes, bytesToBase64 } from "../src/core/base64.js";
import {
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord,
  createBookmark,
  createVaultRecord
} from "../src/core/vault.js";
import { getBookmarkSearchResults } from "../src/core/bookmark-search.js";
import { flattenNativeBookmarkTree } from "../src/core/native-bookmarks.js";
import {
  hasVaultRecordData,
  loadFolderCatalog,
  loadPendingQuickCaptures,
  savePendingQuickCaptures,
  saveVaultRecord
} from "../src/core/storage.js";
import {
  flushPendingQuickCaptures,
  queueCurrentPageQuickCapture,
  queueQuickCaptureBookmark
} from "../src/core/quick-capture.js";
import {
  getFolderCatalogFromBookmarks,
  syncFolderCatalogFromBookmarks
} from "../src/core/folder-catalog.js";
import { normalizeVaultRecord } from "../src/core/validation.js";

test("base64 helpers round-trip bytes", () => {
  const source = new Uint8Array([0, 1, 2, 253, 254, 255]);
  const encoded = bytesToBase64(source);
  const decoded = base64ToBytes(encoded);

  assert.deepEqual([...decoded], [...source]);
});

test("vault can be created and unlocked with the same password", async () => {
  const created = await createVaultRecord("super-secret", 15);
  const unlocked = await unlockVaultRecord(created.record, "super-secret");

  assert.equal(unlocked.record.version, 1);
  assert.equal(unlocked.record.meta.bookmarkCount, 0);
  assert.equal(unlocked.bookmarks.length, 0);
  assert.ok(unlocked.encodedKey.length > 10);
});

test("unlock rejects wrong password", async () => {
  const created = await createVaultRecord("correct-password", 15);

  await assert.rejects(
    () => unlockVaultRecord(created.record, "wrong-password"),
    /主密码不正确/
  );
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

test("vault validation rejects unsupported version", () => {
  assert.throws(
    () =>
      normalizeVaultRecord({
        version: 2,
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
