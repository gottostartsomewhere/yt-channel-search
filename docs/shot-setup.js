/*
 * Store screenshot helper. Not shipped: build.js only copies its SHARED list,
 * and docs is not in it.
 *
 * Puts the panel into each of the five states STORE.txt asks for, so capturing
 * a set is five keystrokes rather than five rounds of clicking dropdowns and
 * hoping the last shot matched the one before it.
 *
 * HOW TO RUN IT
 *
 * The panel is a content script, so it lives in an isolated world and the page
 * console cannot see `ui` or `setView`. In DevTools, open the Console, find the
 * context dropdown in its toolbar (it says "top" by default) and switch it to
 * "Channel Search+ for YouTube". Everything below is then in scope.
 *
 * Paste this whole file once, then call shot(1) through shot(5).
 *
 * CAPTURING AT EXACTLY 1280x800
 *
 * Ctrl+Shift+M for the device toolbar, set a custom 1280 x 800, collapse
 * YouTube's sidebar with the hamburger to give the panel its full width, then
 * Ctrl+Shift+P and run "Capture screenshot". That writes a real 1280x800 PNG
 * with no OS window chrome in it.
 */

function shot(n) {
  const clear = () => {
    ui.kw.value = "";
    for (const el of [ui.duration, ui.views, ui.uploaded, ui.watched, ui.fits]) {
      el.value = "";
      el.classList.add("ytcs-dim");
    }
    ui.sort.value = "newest";
  };
  const set = (el, value) => {
    el.value = value;
    el.classList.toggle("ytcs-dim", !value);
  };

  clear();
  setView("search");

  if (n === 1) {
    // The thumbnail. It has to say "a precise query is running against a big
    // catalogue" with no caption, so: a keyword, two lit pills, and a count
    // that is visibly a small fraction of the whole.
    ui.kw.value = "review";
    set(ui.duration, "240-1200");
    set(ui.watched, "new");
  } else if (n === 2) {
    set(ui.sort, "starthere");
    ui.sort.classList.remove("ytcs-dim");
  } else if (n === 3) {
    setView("insights");
    setInsight("overview");
  } else if (n === 4) {
    setView("insights");
    setInsight("titles");
  } else if (n === 5) {
    setView("insights");
    setInsight("watchlist");
  }

  applyView();
  window.scrollTo(0, 0);
  return "shot " + n + " ready: " + ui.count.textContent;
}

console.log("shot(1)..shot(5) ready. See STORE.txt for what each one is for.");
