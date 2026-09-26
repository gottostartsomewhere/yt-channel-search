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
 * "Needle for YouTube: Channel Search, History & Filters". Everything below is then in scope.
 *
 * Paste this whole file once, then call shot(1) through shot(5).
 *
 * CAPTURING AT EXACTLY 1280x800
 *
 * Ctrl+Shift+M for the device toolbar, set a custom 1280 x 800, collapse
 * YouTube's sidebar with the hamburger to give the panel its full width, then
 * Ctrl+Shift+P and run "Capture screenshot". That writes a real 1280x800 PNG
 * with no OS window chrome in it.
 *
 * WHICH CHANNEL
 *
 * Shots 1 and 3 want a channel people recognise with a deep back catalogue.
 *
 * Shot 2 shows watch state, so it has to be a channel you have genuinely
 * watched. On a channel you have never opened every video reads as not
 * started, there are no progress bars, nothing is dimmed, and the shot proves
 * nothing.
 *
 * Shots 4 and 5 need setup before they will show anything: the watchlist wants
 * two or three tracked channels already refreshed, and Compare wants a channel
 * entered and fetched. Do that first, then call shot().
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
    // that is visibly a small fraction of the whole. Change the keyword to
    // something that actually lands on whatever channel you picked.
    ui.kw.value = "review";
    set(ui.duration, "240-1200");
    set(ui.views, "1000000-10000000");
  } else if (n === 2) {
    // Watch state, the thing no competitor does. Needs a channel you watch.
    set(ui.watched, "new");
    set(ui.fits, "30");
  } else if (n === 3) {
    setView("insights");
    setInsight("overview");
  } else if (n === 4) {
    setView("insights");
    setInsight("watchlist");
  } else if (n === 5) {
    setView("insights");
    setInsight("compare");
  }

  applyView();
  window.scrollTo(0, 0);
  return "shot " + n + " ready: " + ui.count.textContent;
}

console.log("shot(1)..shot(5) ready. See STORE.txt for what each one is for.");
