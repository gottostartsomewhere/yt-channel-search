/*
 * Relays the keyboard shortcut to the content script. The panel lives in the
 * page, so the command has to be forwarded to whichever tab is in front.
 */
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-panel") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id || !/^https:\/\/www\.youtube\.com\//.test(tab.url || "")) return;
    chrome.tabs.sendMessage(tab.id, { type: "ytcs-toggle" }, () => void chrome.runtime.lastError);
  });
});
