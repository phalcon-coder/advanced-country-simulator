// ============================================================
// js/supabase.js — one shared Supabase client for the whole game.
// Loaded once, after the supabase-js CDN script, before every
// other js/*.js file. Everything else just references `supabase`.
// ============================================================
var SUPABASE_URL = 'https://otfcugzjpretomyvwhny.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90ZmN1Z3pqcHJldG9teXZ3aG55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzUwNDQsImV4cCI6MjEwMjk1MTA0NH0.NXWr4ZJ9CNyDlmeGecls6gseeKgFqSaebJmslK-8SAo';
// ===================================================================================

var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
