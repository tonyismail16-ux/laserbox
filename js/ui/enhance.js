/* enhance.js — chrome behaviour only: theme, popover menus, sidebar toggles,
   3D toolbar wiring. Runs after UIController.init(); touches no geometry. */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = () => window.LaserScene;
  const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('lb-theme', t); } catch (e) {}
    if (S()) S().setTheme(t === 'dark');
    const l = $('themeLabel'); if (l) l.textContent = t === 'dark' ? 'Dark' : 'Light';
  }

  // ---- popovers: one open at a time, close on outside click / Escape / chosen action ----
  function initPopovers() {
    const pairs = [['btnMenu', 'menuMain'], ['btnExportMenu', 'menuExport']];
    const closeAll = () => pairs.forEach(([b, m]) => { $(m).hidden = true; $(b).setAttribute('aria-expanded', 'false'); });
    pairs.forEach(([b, m]) => {
      $(b).addEventListener('click', (e) => {
        e.stopPropagation();
        const open = $(m).hidden;
        closeAll();
        $(m).hidden = !open;
        $(b).setAttribute('aria-expanded', String(open));
      });
      $(m).addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('[data-close]')) closeAll(); });
    });
    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  }

  // ---- sidebars: collapse on desktop, slide-over drawers on mobile ----
  function initSidebars() {
    const shell = document.querySelector('.app-shell');
    const sides = { left: document.querySelector('.sidebar-left'), right: document.querySelector('.sidebar-right') };
    const btns = { left: $('btnToggleLeft'), right: $('btnToggleRight') };
    const sync = () => {
      for (const k of ['left', 'right']) {
        const shown = isMobile() ? sides[k].classList.contains('open') : !shell.classList.contains('collapse-' + k);
        btns[k].classList.toggle('on', shown);
      }
    };
    for (const k of ['left', 'right']) {
      btns[k].addEventListener('click', () => {
        if (isMobile()) {
          const other = sides[k === 'left' ? 'right' : 'left'];
          other.classList.remove('open');
          sides[k].classList.toggle('open');
        } else {
          shell.classList.toggle('collapse-' + k);
        }
        sync();
      });
    }
    // phones/tablets start with the canvas front and centre
    if (isMobile()) { shell.classList.remove('collapse-left', 'collapse-right'); }
    $('canvas3d').addEventListener('pointerdown', () => { if (isMobile()) { Object.values(sides).forEach(s => s.classList.remove('open')); sync(); } });
    window.addEventListener('resize', sync);
    sync();
  }

  // keep the WebGL canvas sized to the stage whenever the layout changes
  function initResize() {
    const stage = document.querySelector('.viewport-stage');
    if (window.ResizeObserver && stage) new ResizeObserver(() => { if (S()) S().resize(); }).observe(stage);
  }

  // expose the active view to CSS so 3D-only controls hide in 2D / Sheets
  function initViewFlag() {
    const sync = () => {
      document.body.dataset.view = !$('stage3d').hidden ? '3d' : !$('stage2d').hidden ? '2d' : 'sheet';
    };
    const mo = new MutationObserver(sync);
    ['stage3d', 'stage2d', 'stageSheet'].forEach(id => mo.observe($(id), { attributes: true, attributeFilter: ['hidden'] }));
    sync();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      applyTheme(document.documentElement.dataset.theme || 'dark');
      $('btnTheme').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
      initPopovers(); initSidebars(); initResize(); initViewFlag();

      $('btnSpin').addEventListener('click', (e) => { const on = !e.currentTarget.classList.contains('active'); e.currentTarget.classList.toggle('active', on); S().setAutoRotate(on); });
      const wf = () => { const b = $('btnWire'), on = !b.classList.contains('active'); b.classList.toggle('active', on); S().setWireframe(on); };
      $('btnWire').addEventListener('click', wf);
      document.addEventListener('keydown', (ev) => { if ((ev.key === 'w' || ev.key === 'W') && !/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName) && !ev.metaKey && !ev.ctrlKey) wf(); });
      $('viewPreset').addEventListener('change', (e) => S().setView(e.target.value));
      $('btnGrid').addEventListener('click', () => S().setGrid($('btnGrid').classList.contains('active')));
    }, 0);
  });
})();
