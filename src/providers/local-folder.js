import { normalizeSyncRevision } from "../core/sync-schema.js";

const DB_NAME = "safeMarksSync";
const DB_VERSION = 1;
const STORE_NAME = "connections";
const FOLDER_HANDLE_KEY = "local-folder";
const REVISIONS_DIRECTORY = "revisions";
const MANIFEST_FILE = "manifest.json";

function requireIndexedDb() {
  if (!globalThis.indexedDB) {
    throw new Error("当前浏览器不支持持久化同步文件夹授权。");
  }
  return globalThis.indexedDB;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = requireIndexedDb().open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开同步目录数据库。"));
  });
}

async function withStore(mode, callback) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try {
        result = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("同步目录数据库操作失败。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("同步目录数据库操作已取消。"));
    });
  } finally {
    database.close();
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("同步目录数据库读取失败。"));
  });
}

export async function saveLocalFolderHandle(handle) {
  if (!handle || handle.kind !== "directory") {
    throw new Error("请选择有效的同步文件夹。");
  }
  await withStore("readwrite", (store) => {
    store.put(handle, FOLDER_HANDLE_KEY);
  });
  return handle;
}

export async function loadLocalFolderHandle() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    return await requestResult(transaction.objectStore(STORE_NAME).get(FOLDER_HANDLE_KEY));
  } finally {
    database.close();
  }
}

export async function clearLocalFolderHandle() {
  await withStore("readwrite", (store) => {
    store.delete(FOLDER_HANDLE_KEY);
  });
}

export async function getLocalFolderPermission(handle, { request = false } = {}) {
  if (!handle) {
    return "missing";
  }
  const options = { mode: "readwrite" };
  if (typeof handle.queryPermission === "function") {
    const current = await handle.queryPermission(options);
    if (current === "granted" || !request) {
      return current;
    }
  }
  if (request && typeof handle.requestPermission === "function") {
    return handle.requestPermission(options);
  }
  return "prompt";
}

async function requireAuthorizedRoot() {
  const handle = await loadLocalFolderHandle();
  if (!handle) {
    throw new Error("尚未选择同步文件夹。");
  }
  const permission = await getLocalFolderPermission(handle);
  if (permission !== "granted") {
    const error = new Error("需要重新授权同步文件夹。");
    error.code = "FOLDER_PERMISSION_REQUIRED";
    throw error;
  }
  return handle;
}

async function writeJsonFile(directory, filename, value) {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(value));
  } finally {
    await writable.close();
  }
}

async function readJsonFile(fileHandle) {
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

export function createLocalFolderProvider() {
  return {
    async getStatus() {
      const handle = await loadLocalFolderHandle();
      return {
        connected: Boolean(handle),
        directoryName: handle?.name ?? "",
        permission: await getLocalFolderPermission(handle)
      };
    },

    async writeRevision(revision) {
      const normalized = normalizeSyncRevision(revision);
      const root = await requireAuthorizedRoot();
      const revisions = await root.getDirectoryHandle(REVISIONS_DIRECTORY, { create: true });
      await writeJsonFile(revisions, `${normalized.revisionId}.json`, normalized);
      return normalized;
    },

    async listRevisions() {
      const root = await requireAuthorizedRoot();
      let revisions;
      try {
        revisions = await root.getDirectoryHandle(REVISIONS_DIRECTORY);
      } catch (error) {
        if (error?.name === "NotFoundError") {
          return [];
        }
        throw error;
      }

      const results = [];
      for await (const [name, handle] of revisions.entries()) {
        if (handle.kind !== "file" || !name.endsWith(".json")) {
          continue;
        }
        try {
          results.push(normalizeSyncRevision(await readJsonFile(handle)));
        } catch {
          // A partially synced or unrelated file is ignored. Immutable valid
          // revisions remain sufficient to reconstruct the graph.
        }
      }
      return results;
    },

    async writeManifest(manifest) {
      const root = await requireAuthorizedRoot();
      await writeJsonFile(root, MANIFEST_FILE, manifest);
    },

    async readManifest() {
      const root = await requireAuthorizedRoot();
      try {
        return await readJsonFile(await root.getFileHandle(MANIFEST_FILE));
      } catch (error) {
        if (error?.name === "NotFoundError" || error instanceof SyntaxError) {
          return null;
        }
        throw error;
      }
    }
  };
}
