/*
 * Relays the keyboard shortcut into the content script.
 *
 * The panel lives in the page, so the command has to be forwarded to whichever
 * YouTube tab is in front. That is the only job this file has.
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

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-panel") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id || !/^https:\/\/www\.youtube\.com\//.test(tab.url || "")) return;
    chrome.tabs.sendMessage(tab.id, { type: "ytcs-toggle" }, () => void chrome.runtime.lastError);
  });
});
