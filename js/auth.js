// ============================================================
// js/auth.js — guards game.html: redirects to login if there's
// no session, otherwise loads the player's profile + country
// into GameState and shows the dashboard.
// ============================================================

(async function initGameAuth() {
  const splash = document.getElementById('authSplash');
  const appRoot = document.getElementById('appRoot');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'auth/login.html';
    return;
  }

  GameState.userId = session.user.id;

  // Profile (username)
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', GameState.userId)
    .maybeSingle();
  GameState.username = profile ? profile.username : null;

  // Country owned by this user
  const { data: country } = await supabase
    .from('countries')
    .select('id,name,flag_url,currency_name,currency_symbol')
    .eq('owner_id', GameState.userId)
    .maybeSingle();

  if (!country) {
    // Signed in but never finished founding a country — send them
    // to finish that instead of showing a broken dashboard.
    window.location.href = 'auth/complete-profile.html';
    return;
  }

  GameState.country.id = country.id;
  GameState.country.name = country.name;
  GameState.country.flagUrl = country.flag_url;
  GameState.country.currencyName = country.currency_name;
  GameState.country.currencySymbol = country.currency_symbol;

  markGameStateReady();

  if (splash) splash.classList.add('hidden');
  if (appRoot) appRoot.classList.remove('hidden');
})();

