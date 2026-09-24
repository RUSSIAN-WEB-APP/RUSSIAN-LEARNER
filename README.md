# Russian Learner 2.1

This is a free static/PWA Russian-learning app built around vocabulary YOU enter.

## 2.1 fixes
- Prevents the Supabase CDN from blocking the entire app. The main app loads in local mode first, then loads Supabase only when cloud features are needed.
- Adds safe runtime error handling so a JavaScript problem shows a diagnostic card instead of a blank screen.
- Versioned asset URLs and a new service-worker cache prevent old JavaScript/CSS from remaining stuck after GitHub Pages deployment.
- Adds purple + yellow signature styling throughout the interface.

## Existing features
- Personal course path generated from your vocabulary topics
- Adaptive review queue with spaced repetition
- Multiple choice, translation, typing, word-bank, listening, fill-in, and speaking challenges
- Free browser text-to-speech in Russian
- Free browser speech recognition where supported
- Reading/listening passages with comprehension questions
- XP, daily goal, streak, gems, achievements, league-style personal board
- Progress dashboard and adaptive Russian Score estimate
- Search/filter/import/export vocabulary
- Local browser persistence
- Optional Supabase account and cloud sync
- PWA manifest + service worker
- Static deployment on GitHub Pages

## Upgrade steps
1. Back up your current GitHub repository using Code -> Download ZIP.
2. Keep your current working `config.js` file. Do not replace it with the blank example.
3. Run the included `supabase.sql` in your existing Supabase project's SQL Editor only if you have not already run the 2.0 schema. If you already ran it, do not delete tables or data.
4. Replace `index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, and `icon.svg` in the GitHub repository.
5. Commit to `main`.
6. Open your GitHub Pages URL and press Ctrl+Shift+R.
7. If the browser still shows the old app, open Chrome/Edge DevTools -> Application -> Service Workers -> Unregister, then Application -> Storage -> Clear site data, then reload.
8. Use Settings -> Sign in / create account to verify cloud auth still works.

## Supabase security
Use only the browser-safe publishable/anon key in `config.js`. Never put a `service_role` or `sb_secret_...` key in the repository.
