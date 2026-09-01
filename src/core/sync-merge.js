import { VERSION } from "./constants.js";
import { normalizeVaultPayload } from "./validation.js";

function bookmarkFingerprint(bookmark) {
  return JSON.stringify({
    url: bookmark.url,
    title: bookmark.title,
    note: bookmark.note,
    folderPath: bookmark.folderPath,
    tags: bookmark.tags,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt
  });
}

function stateFingerprint(state) {
  if (!state) {
    return "absent";
  }
  if (state.kind === "deleted") {
    return `deleted:${state.value.deletedAt}`;
  }
  return `bookmark:${bookmarkFingerprint(state.value)}`;
}

function buildStateMap(payload) {
  const normalized = normalizeVaultPayload(payload);
  const states = new Map();
  for (const bookmark of normalized.bookmarks) {
    states.set(bookmark.id, { kind: "bookmark", value: bookmark });
  }
  for (const tombstone of normalized.tombstones) {
    if (!states.has(tombstone.id)) {
      states.set(tombstone.id, { kind: "deleted", value: tombstone });
    }
  }
  return states;
}

function sameState(left, right) {
  return stateFingerprint(left) === stateFingerprint(right);
}

function createConflictBookmark(bookmark, createId) {
  return {
    ...bookmark,
    id: createId(),
    title: `${bookmark.title}（同步冲突副本）`,
    updatedAt: Date.now()
  };
}

function addState(result, state) {
  if (!state) {
    return;
  }
  if (state.kind === "bookmark") {
    result.bookmarks.push(state.value);
  } else {
    result.tombstones.push(state.value);
  }
}

export function mergeVaultPayloads({
  base,
  local,
  remote,
  createId = () => `bm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}) {
  const baseStates = buildStateMap(base ?? { schemaVersion: VERSION, bookmarks: [], tombstones: [] });
  const localStates = buildStateMap(local);
  const remoteStates = buildStateMap(remote);
  const ids = new Set([
    ...baseStates.keys(),
    ...localStates.keys(),
    ...remoteStates.keys()
  ]);
  const result = { schemaVersion: VERSION, bookmarks: [], tombstones: [] };
  const conflicts = [];

  for (const id of ids) {
    const baseState = baseStates.get(id);
    const localState = localStates.get(id);
    const remoteState = remoteStates.get(id);
    const localChanged = !sameState(localState, baseState);
    const remoteChanged = !sameState(remoteState, baseState);

    if (!localChanged && !remoteChanged) {
      addState(result, localState ?? remoteState ?? baseState);
      continue;
    }
    if (localChanged && !remoteChanged) {
      addState(result, localState);
      continue;
    }
    if (!localChanged && remoteChanged) {
      addState(result, remoteState);
      continue;
    }
    if (sameState(localState, remoteState)) {
      addState(result, localState);
      continue;
    }

    if (localState?.kind === "deleted" && remoteState?.kind === "deleted") {
      addState(
        result,
        localState.value.deletedAt >= remoteState.value.deletedAt ? localState : remoteState
      );
      continue;
    }
    if (localState?.kind === "bookmark" && remoteState?.kind === "bookmark") {
      const localContent = bookmarkFingerprint({ ...localState.value, updatedAt: 0 });
      const remoteContent = bookmarkFingerprint({ ...remoteState.value, updatedAt: 0 });
      if (localContent === remoteContent) {
        addState(
          result,
          localState.value.updatedAt >= remoteState.value.updatedAt ? localState : remoteState
        );
        continue;
      }
    }

    conflicts.push({ id, local: localState ?? null, remote: remoteState ?? null });

    if (localState?.kind === "bookmark" && remoteState?.kind === "bookmark") {
      addState(result, localState);
      result.bookmarks.push(createConflictBookmark(remoteState.value, createId));
      continue;
    }

    // Delete/edit conflicts preserve the edited copy. Deletion remains visible in
    // conflict metadata, but never silently destroys the only surviving content.
    const survivingBookmark = localState?.kind === "bookmark"
      ? localState
      : remoteState?.kind === "bookmark"
        ? remoteState
        : null;
    addState(result, survivingBookmark ?? localState ?? remoteState);
  }

  return {
    payload: normalizeVaultPayload(result),
    conflicts
  };
}

export function findRevisionHeadIds(revisions) {
  const ids = new Set(revisions.map((revision) => revision.revisionId));
  const parentIds = new Set();
  for (const revision of revisions) {
    for (const parentId of revision.parentRevisionIds) {
      if (ids.has(parentId)) {
        parentIds.add(parentId);
      }
    }
  }
  return [...ids].filter((id) => !parentIds.has(id));
}
