// ── Theme: dark default, persisted, no flash ───────────────────
// Apply BEFORE paint. This file is loaded as a normal <script> in
// <head> so the attribute is set before the body renders.
(function () {
  try {
    var saved = localStorage.getItem("arc-agentic-theme");
    document.documentElement.setAttribute("data-theme", saved === "light" ? "light" : "dark");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();

// Wire the toggle button(s) once the DOM is ready.
window.addEventListener("DOMContentLoaded", function () {
  function current() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }
  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("arc-agentic-theme", theme); } catch (e) {}
  }
  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      apply(current() === "light" ? "dark" : "light");
    });
  });
});
