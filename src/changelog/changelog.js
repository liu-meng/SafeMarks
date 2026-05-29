import { initializeI18n, localizeDocument, t } from "../shared/i18n.js";
import { CHANGELOG } from "../shared/changelog.js";

try {
  await initializeI18n();
} finally {
  localizeDocument();
}

const changelogList = document.querySelector("#changelog-list");

for (const release of CHANGELOG) {
  const entry = document.createElement("section");
  entry.className = "panel panel-pad changelog-entry";

  const header = document.createElement("div");
  header.className = "changelog-entry-header";

  const versionBadge = document.createElement("span");
  versionBadge.className = "badge";
  versionBadge.textContent = `v${release.version}`;

  const date = document.createElement("span");
  date.className = "helper-text";
  date.textContent = release.date;

  header.append(versionBadge, date);

  const list = document.createElement("ul");
  list.className = "changelog-changes";

  for (const change of release.changes) {
    const item = document.createElement("li");
    item.textContent = t(change);
    list.append(item);
  }

  entry.append(header, list);
  changelogList.append(entry);
}
