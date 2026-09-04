// ============================================================
// js/app.js — bootstraps the dashboard once GameState is ready:
// fills the right sidebar, registers sidebar modules, wires the
// top icon bar (account/country popups are real; the rest are
// stubs until those systems exist).
// ============================================================

onGameStateReady(function(state) {
  renderRightSidebar(state);
  registerAllModules();
  initRouter();
  wireTopIcons(state);
});

// ---------- Right sidebar ----------
function renderRightSidebar(state) {
  const flagEl = document.getElementById('rsFlag');
  if (state.country.flagUrl) {
    flagEl.outerHTML = `<img id="rsFlag" class="country-flag" src="${state.country.flagUrl}" alt="flag" />`;
  } else {
    flagEl.classList.add('placeholder');
    flagEl.textContent = 'NO FLAG';
  }

  document.getElementById('rsCountryName').textContent = state.country.name || 'Unnamed';
  document.getElementById('rsCountryId').textContent = state.country.id || '';

  // Placeholders — these systems don't exist yet, so we show an
  // honest "—" instead of inventing numbers.
  document.getElementById('rsPopulation').textContent = state.stats.population ?? '—';
  document.getElementById('rsHappiness').textContent = state.stats.happinessIndex ?? '—';
  document.getElementById('rsImmigration').textContent = state.stats.immigrationRate ?? '—';
  document.getElementById('rsBalance').textContent = state.stats.balance ?? '—';
  document.getElementById('rsIncome').textContent = state.stats.income ?? '—';
  document.getElementById('rsExpenditure').textContent = state.stats.expenditure ?? '—';
}

// ---------- Sidebar modules ----------
// "Map" is the only one wired to something real right now (your
// existing worldmap.html). Everything else registers with just a
// label/icon so the nav works, and falls back to "coming soon"
// until each module gets built.
function registerAllModules() {
  registerModule('map', {
    label: 'Map',
    icon: 'fa-map',
    render(container) {
      container.innerHTML = `<iframe src="../worldmap.html" style="width:100%;height:100%;min-height:70vh;border:1px solid var(--border);border-radius:var(--radius-md);background:#fff;"></iframe>`;
    }
  });

  registerModule('provinces-cities', { label: 'Provinces & Cities', icon: 'fa-city' });
  registerModule('industries',       { label: 'Industries',         icon: 'fa-industry' });
  registerModule('power',            { label: 'Power',               icon: 'fa-bolt' });
  registerModule('transport',        { label: 'Transport',           icon: 'fa-train' });
  registerModule('defence',          { label: 'Defence',             icon: 'fa-shield-halved' });
  registerModule('network',          { label: 'Network',             icon: 'fa-tower-broadcast' });
  registerModule('administration',   { label: 'Administration',      icon: 'fa-gavel' });
  registerModule('economy-trade',    { label: 'Economy & Trade',     icon: 'fa-coins' });
  registerModule('diplomacy',        { label: 'Diplomacy',           icon: 'fa-handshake' });
  registerModule('education',        { label: 'Education',           icon: 'fa-graduation-cap' });
  registerModule('research',         { label: 'Research',            icon: 'fa-flask' });
  registerModule('tourism',          { label: 'Tourism',             icon: 'fa-umbrella-beach' });
  registerModule('entertainment',    { label: 'Entertainment',       icon: 'fa-futbol' });
}

// ---------- Top icon bar ----------
function wireTopIcons(state) {
  document.getElementById('iconAccount').addEventListener('click', () => openAccountModal(state));
  document.getElementById('iconCountry').addEventListener('click', () => openCountryModal(state));

  document.getElementById('iconWiki').addEventListener('click', () => {
    window.open('https://en.wikipedia.org', '_blank'); // placeholder target until a real World Wiki exists
  });

  document.getElementById('iconCompanies').addEventListener('click', () => {
    alert('Companies & Contracts — coming soon.');
  });

  document.getElementById('iconMap').addEventListener('click', () => navigateToModule('map'));

  document.getElementById('iconNotifications').addEventListener('click', () => {
    alert('Notifications — coming soon.');
  });

  document.getElementById('iconChat').addEventListener('click', () => {
    alert('Chat — coming soon.');
  });

  document.getElementById('iconBank').addEventListener('click', () => {
    alert('Bank — coming soon.');
  });

  // Shared modal close wiring
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.classList.remove('active');
    });
    overlay.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => overlay.classList.remove('active'));
    });
  });
}

function openAccountModal(state) {
  document.getElementById('acctUsername').textContent = state.username || '—';
  document.getElementById('acctEmail').textContent = window.__cachedEmail || '—';
  document.getElementById('accountModal').classList.add('active');

  // Email isn't in GameState (kept out of the shared object since
  // no other module needs it) — fetch it lazily on first open.
  if (!window.__cachedEmail) {
    supabase.auth.getUser().then(({ data }) => {
      window.__cachedEmail = (data && data.user) ? data.user.email : '—';
      document.getElementById('acctEmail').textContent = window.__cachedEmail;
    });
  }
}

function openCountryModal(state) {
  const flagWrap = document.getElementById('countryModalFlag');
  flagWrap.innerHTML = state.country.flagUrl
    ? `<img class="modal-flag" src="${state.country.flagUrl}" alt="flag" />`
    : '';
  document.getElementById('cmName').textContent = state.country.name || '—';
  document.getElementById('cmId').textContent = state.country.id || '—';
  document.getElementById('cmCurrency').textContent = state.country.currencyName
    ? `${state.country.currencySymbol || ''} ${state.country.currencyName}`
    : '—';
  document.getElementById('cmRating').textContent = '— (no rating system yet)';
  document.getElementById('countryModal').classList.add('active');
}

