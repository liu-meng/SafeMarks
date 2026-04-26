import test from "node:test";
import assert from "node:assert/strict";

import { base64ToBytes, bytesToBase64 } from "../src/core/base64.js";
import {
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord,
  createVaultRecord
} from "../src/core/vault.js";
import { flattenNativeBookmarkTree } from "../src/core/native-bookmarks.js";
import { hasVaultRecordData } from "../src/core/storage.js";
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
