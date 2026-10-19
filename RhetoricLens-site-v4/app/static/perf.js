/* RhetoricLens adaptive performance. Sets <html data-perf="lite"> on weak devices;
   all visual savings live in CSS under html[data-perf="lite"]. Nothing else depends on this file.
   Override: ?lite=1 forces lite, ?lite=0 forces the full design, ?lite=auto clears the override. */
(function () {
  var root = document.documentElement;
  function get(store, key) { try { return window[store].getItem(key); } catch (e) { return null; } }
  function set(store, key, val) { try { if (val === null) window[store].removeItem(key); else window[store].setItem(key, val); } catch (e) {} }
  function apply(on) { if (on) root.setAttribute("data-perf", "lite"); else root.removeAttribute("data-perf"); }

  var q = /[?&]lite=(0|1|auto)\b/.exec(location.search);
  if (q) set("localStorage", "rl-perf", q[1] === "auto" ? null : q[1] === "1" ? "lite" : "full");
  var forced = get("localStorage", "rl-perf");          // explicit choice wins
  if (forced) { apply(forced === "lite"); return; }
  if (get("sessionStorage", "rl-perf-auto") === "lite") { apply(true); return; }

  var n = navigator, c = n.connection || {};
  var weak = (n.deviceMemory && n.deviceMemory <= 4) ||
             (n.hardwareConcurrency && n.hardwareConcurrency <= 2) ||
             c.saveData === true || /(^|-)2g$|3g/.test(c.effectiveType || "");
  if (weak) { apply(true); return; }

  // Safari/Firefox expose no device hints: measure real frame times once the page has settled.
  window.addEventListener("load", function () {
    setTimeout(function () {
      if (document.hidden || root.getAttribute("data-perf") === "lite") return;
      var t = [], last = 0, count = 0;
      function step(now) {
        if (last) t.push(now - last);
        last = now;
        if (++count < 50 && !document.hidden) { requestAnimationFrame(step); return; }
        if (document.hidden || t.length < 30) return;
        t.sort(function (a, b) { return a - b; });
        if (t[t.length >> 1] > 34) { apply(true); set("sessionStorage", "rl-perf-auto", "lite"); }  // median under ~30fps
      }
      requestAnimationFrame(step);
    }, 1500);
  });
})();
