import { createVaultRecord, encryptBookmarksWithEncodedKey } from "../core/vault.js";
import { saveVaultRecord } from "../core/storage.js";
import { sessionSet } from "../core/session.js";
import { initializeI18n, localizeDocument, t } from "../shared/i18n.js";

try {
  await initializeI18n();
} finally {
  localizeDocument();
}

const elements = {
  progressFill: document.querySelector("#progress-fill"),
  progressLabel: document.querySelector("#progress-label"),
  stepPassword: document.querySelector("#step-password"),
  stepImport: document.querySelector("#step-import"),
  stepComplete: document.querySelector("#step-complete"),
  setupForm: document.querySelector("#onboarding-setup-form"),
  password: document.querySelector("#onboarding-password"),
  confirm: document.querySelector("#onboarding-confirm"),
  passwordError: document.querySelector("#step-password-error"),
  importBrowser: document.querySelector("#import-browser"),
  skipImport: document.querySelector("#skip-import"),
  importStatus: document.querySelector("#step-import-status"),
  finish: document.querySelector("#finish-onboarding")
};

let encodedKey = "";
let record = null;
let bookmarks = [];

function showStep(step) {
  elements.stepPassword.hidden = step !== 1;
  elements.stepImport.hidden = step !== 2;
  elements.stepComplete.hidden = step !== 3;

  const percent = Math.round((step / 3) * 100);
  elements.progressFill.style.width = `${percent}%`;
  elements.progressLabel.textContent = t("第 {step} 步 / 3", { step });
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

// Step 1: Create vault
elements.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.passwordError.hidden = true;

  const password = elements.password.value;
  const confirm = elements.confirm.value;

  if (password !== confirm) {
    showError(elements.passwordError, t("两次输入的密码不一致。"));
    return;
  }

  if (!password) {
    showError(elements.passwordError, t("请输入主密码。"));
    return;
  }

  try {
    const result = await createVaultRecord(password, 5);
    record = result.record;
    encodedKey = result.encodedKey;
    await saveVaultRecord(record);
    await sessionSet(encodedKey, 5);
    showStep(2);
  } catch (error) {
    showError(elements.passwordError, error instanceof Error ? error.message : String(error));
  }
});

// Step 2: Import browser bookmarks
elements.importBrowser.addEventListener("click", async () => {
  try {
    const chromeBookmarks = await chrome.bookmarks.getTree();
    bookmarks = flattenChromeBookmarks(chromeBookmarks);
    elements.importStatus.textContent = t("已导入 {count} 条书签。", { count: bookmarks.length });
    elements.importStatus.hidden = false;

    if (bookmarks.length > 0 && record && encodedKey) {
      const nextRecord = await encryptBookmarksWithEncodedKey(record, bookmarks, encodedKey);
      await saveVaultRecord(nextRecord);
      record = nextRecord;
    }

    setTimeout(() => showStep(3), 800);
  } catch (error) {
    elements.importStatus.textContent = t("导入失败：") + (error instanceof Error ? error.message : String(error));
    elements.importStatus.hidden = false;
  }
});

elements.skipImport.addEventListener("click", () => {
  showStep(3);
});

// Step 3: Finish
elements.finish.addEventListener("click", () => {
  window.close();
});

// Helpers
function flattenChromeBookmarks(nodes, folderPath = "") {
  const results = [];

  for (const node of nodes) {
    if (node.url) {
      results.push({
        id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: node.title || "",
        url: node.url,
        folderPath: folderPath,
        note: "",
        tags: [],
        createdAt: node.dateAdded || Date.now()
      });
    }

    if (node.children) {
      const nextPath = node.title && folderPath
        ? `${folderPath}/${node.title}`
        : node.title || folderPath;
      results.push(...flattenChromeBookmarks(node.children, nextPath));
    }
  }

  return results;
}

// Start at step 1
showStep(1);
