import test from "node:test";
import assert from "node:assert/strict";

import { base64ToBytes, bytesToBase64 } from "../src/core/base64.js";
import {
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord,
  createVaultRecord
} from "../src/core/vault.js";
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

  assert.equal(bookmarks[0].title, "Example Docs");
  assert.equal(bookmarks[0].url, "https://example.com/docs");
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
