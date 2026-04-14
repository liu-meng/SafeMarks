import { AUTO_LOCK_ALARM } from "../core/constants.js";
import {
  clearAutoLockAlarm,
  clearSessionRecord,
  createSessionRecord,
  isSessionExpired,
  readSessionRecord,
  scheduleAutoLock,
  writeSessionRecord
} from "../core/session.js";

async function handleSessionSet(message) {
  const session = createSessionRecord({
    encodedKey: message.encodedKey,
    autoLockMinutes: message.autoLockMinutes
  });

  await writeSessionRecord(session);
  await scheduleAutoLock(session.expiresAt);

  return {
    status: "unlocked",
    session
  };
}

async function handleSessionTouch() {
  const current = await readSessionRecord();
  if (!current) {
    return { status: "locked", session: null };
  }

  if (isSessionExpired(current)) {
    await clearSessionRecord();
    await clearAutoLockAlarm();
    return { status: "expired", session: null };
  }

  const session = createSessionRecord({
    encodedKey: current.encodedKey,
    autoLockMinutes: current.autoLockMinutes
  });

  await writeSessionRecord(session);
  await scheduleAutoLock(session.expiresAt);

  return {
    status: "unlocked",
    session
  };
}

async function handleSessionLock() {
  await clearSessionRecord();
  await clearAutoLockAlarm();
  return {
    status: "locked",
    session: null
  };
}

async function handleSessionStatus() {
  const session = await readSessionRecord();

  if (!session) {
    return {
      status: "locked",
      session: null
    };
  }

  if (isSessionExpired(session)) {
    await clearSessionRecord();
    await clearAutoLockAlarm();
    return {
      status: "expired",
      session: null
    };
  }

  return {
    status: "unlocked",
    session
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    SESSION_SET: () => handleSessionSet(message),
    SESSION_TOUCH: () => handleSessionTouch(),
    SESSION_LOCK: () => handleSessionLock(),
    SESSION_STATUS: () => handleSessionStatus()
  };

  const handler = handlers[message?.type];
  if (!handler) {
    return false;
  }

  handler()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_LOCK_ALARM) {
    return;
  }

  await clearSessionRecord();
  await clearAutoLockAlarm();
});
