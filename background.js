/*
 * Relays the keyboard shortcut into the content script.
 *
 * The panel lives in the page, so the command has to be forwarded to whichever
 * YouTube tab is in front. That is the only job this file has.
 */

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-panel") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id || !/^https:\/\/www\.youtube\.com\//.test(tab.url || "")) return;
    chrome.tabs.sendMessage(tab.id, { type: "ytcs-toggle" }, () => void chrome.runtime.lastError);
  });
});
