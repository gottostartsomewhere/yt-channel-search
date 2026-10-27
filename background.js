/*
 * Relays the keyboard shortcut into the content script.
 *
 * The panel lives in the page, so the command has to be forwarded to whichever
 * YouTube tab is in front. That is this file's first job; the badge and the
 * install and uninstall pages below are the others.
 *
 * Note on permissions, because it is not obvious and someone will try to tidy
 * it away: the tab.url read below only works because the manifest asks for
 * host_permissions on www.youtube.com. chrome.tabs.query leaves url, title and
 * favIconUrl undefined unless the extension holds either the "tabs" permission
 * or a host permission matching that tab.
 *
 * Reading the fetches alone, host_permissions looks redundant, since the
 * content script only ever requests youtube.com from a youtube.com page and
 * same-origin needs no grant. Removing it on that reasoning would silently
 * break this shortcut and the popup's channel detection, with no error.
 *
 * The alternative is the "tabs" permission, which is broader and shows the
 * user a browsing-history warning at install. A host permission scoped to one
 * site is the narrower of the two, so it is the one asked for.
 */

/*
 * Its second job: the badge on the toolbar icon. Mostly that is how many new
 * videos are waiting in searches you follow: the content script counts, this
 * only paints it, since a page cannot touch the icon itself. After an update
 * with something worth seeing it says NEW instead, until the popup is opened,
 * which is where "What's new" is. A follow count always wins over NEW.
 * No permission needed for either.
 */
let followCount = 0;
let whatsNew = false;

function paintBadge() {
  const action = chrome.action || chrome.browserAction;
  if (!action) return;
  const text = followCount ? (followCount > 99 ? "99+" : String(followCount)) : whatsNew ? "NEW" : "";
  action.setBadgeText({ text });
  action.setBadgeBackgroundColor({ color: "#e5484d" });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "ytcs-badge") return;
  followCount = Math.max(0, msg.n | 0);
  paintBadge();
});

chrome.storage.local.get({ whatsNew: "" }, (got) => {
  whatsNew = !!(got && got.whatsNew);
  paintBadge();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.whatsNew) return;
  whatsNew = !!changes.whatsNew.newValue;
  paintBadge();
});

/*
 * Its third: the two pages that bracket an install. A fresh install opens the
 * welcome page once, which shows the three places Needle works, since nothing
 * on YouTube changes visibly until you use the search bar. Removing it opens a
 * one-question page asking why, the only way to learn what made somebody leave.
 * Neither carries anything about the person: fixed URLs, no parameters.
 *
 * An update opens nothing. It only marks What's new, for the popup to show.
 */
const SITE = "https://gottostartsomewhere.github.io/needle/";
const WHATS_NEW_FROM = [2, 2];

function olderThan(version, target) {
  const v = String(version || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < target.length; i++) {
    if ((v[i] || 0) !== target[i]) return (v[i] || 0) < target[i];
  }
  return false;
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: SITE + "welcome/" });
  } else if (details.reason === "update" && olderThan(details.previousVersion, WHATS_NEW_FROM)) {
    chrome.storage.local.set({ whatsNew: chrome.runtime.getManifest().version });
  }
});

if (chrome.runtime.setUninstallURL) chrome.runtime.setUninstallURL(SITE + "bye/");

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-panel") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id || !/^https:\/\/www\.youtube\.com\//.test(tab.url || "")) return;
    // The panel decides for itself whether this page is one it opens on.
    chrome.tabs.sendMessage(tab.id, { type: "ytcs-toggle" }, () => void chrome.runtime.lastError);
  });
});
