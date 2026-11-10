/**
 * main.js — bootstraps the application once the DOM is ready.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Copyright footer (bottom-right). Year is dynamic; re-checked hourly so a
  // tab left open across New Year's Eve updates itself.
  const stamp = () => {
    const el = document.getElementById('appCopyright');
    if (el && window.Branding) { el.textContent = window.Branding.notice(); el.title = window.Branding.notice(); }
  };
  stamp();
  setInterval(stamp, 60 * 60 * 1000);
  try {
    window.UIController.init();
  } catch (err) {
    console.error('LaserBox Studio failed to start:', err);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#12151b;color:#f3c8c5;font-family:monospace;padding:40px;text-align:center;';
    el.textContent = 'LaserBox Studio failed to start: ' + (err && err.message ? err.message : err);
    document.body.appendChild(el);
  }
});
