// ============================================================
// js/router.js — swaps what's shown in #loaderArea when a
// sidebar module is clicked. Each module registers a render
// function; unregistered modules fall back to a "coming soon"
// empty state so the nav is fully clickable from day one even
// before every module is built.
// ============================================================

var ModuleRegistry = {}; // key -> { label, icon, render(container) }

function registerModule(key, opts) {
  ModuleRegistry[key] = opts;
}

function renderComingSoon(container, label) {
  container.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-hammer"></i>
      <h3>${label}</h3>
      <p>This module isn't built yet. It'll show up here once it's ready — everything else on the dashboard works in the meantime.</p>
    </div>
  `;
}

function navigateToModule(key) {
  const loaderArea = document.getElementById('loaderArea');
  const loaderTitle = document.getElementById('loaderTitle');
  const mod = ModuleRegistry[key];

  document.querySelectorAll('#leftSidebar .module-nav li').forEach(li => {
    li.classList.toggle('active', li.dataset.module === key);
  });

  if (!mod) {
    loaderTitle.innerHTML = `<i class="fas fa-question"></i> Unknown module`;
    renderComingSoon(loaderArea, key);
    return;
  }

  loaderTitle.innerHTML = `<i class="fas ${mod.icon}"></i> ${mod.label}`;
  loaderArea.innerHTML = '';

  if (typeof mod.render === 'function') {
    mod.render(loaderArea);
  } else {
    renderComingSoon(loaderArea, mod.label);
  }

  window.location.hash = key;
}

function initRouter() {
  document.querySelectorAll('#leftSidebar .module-nav button').forEach(btn => {
    btn.addEventListener('click', function() {
      navigateToModule(this.closest('li').dataset.module);
    });
  });

  const startKey = (window.location.hash || '#map').slice(1);
  navigateToModule(ModuleRegistry[startKey] ? startKey : 'map');
}

