# Russian Learner

A free, mobile-friendly Russian vocabulary web app with:

- vocabulary and phrase storage
- Russian speech using the browser's text-to-speech
- search and categories
- flashcard-style spaced repetition
- progress tracking and streaks
- generated practice phrases from saved vocabulary
- approximate A1-C2 vocabulary milestones
- local browser storage
- optional Supabase authentication + cloud sync
- free deployment with GitHub Pages

## 1. Fast test (no account)

Open `index.html` in Chrome or Edge. Choose **Use locally**. Your data will be stored in that browser.

## 2. Cloud login + syncing

### Create the Supabase project

1. Go to https://supabase.com/ and create a free account/project.
2. Open **SQL Editor**.
3. Paste all of `supabase.sql` and run it.
4. Open **Project Settings → API**.
5. Copy your Project URL and your browser-safe **Publishable/anon key**.
6. Open `config.js` and replace the two empty strings.
7. Do NOT put a `service_role` or secret key in `config.js`.
8. Refresh the app. Create an account and sign in.

The database has Row Level Security policies so authenticated users can only read/write their own rows.

### Email confirmation

Supabase may ask users to confirm their email depending on your Auth settings. For a personal testing project, you can keep confirmation enabled (recommended), or adjust the Auth email-confirmation setting in the Supabase dashboard if you understand the trade-off.

## 3. GitHub Pages deployment

This project is plain HTML/CSS/JavaScript, so there is no build step.

1. Create a GitHub account at https://github.com/ if you do not already have one.
2. Create a new **public** repository, e.g. `russian-learner`.
3. Upload these files to the repository root:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
4. You can also upload `README.md`, `config.example.js`, and `supabase.sql`.
5. In GitHub, open **Settings → Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Select `main` and `/ (root)`.
8. Save.
9. GitHub will publish the site at a URL similar to:
   `https://YOUR-GITHUB-USERNAME.github.io/russian-learner/`

Important: GitHub Pages is public. The Supabase browser-safe key is designed for client applications, but your database is protected by the SQL Row Level Security policies. Never commit a Supabase service-role/secret key.

## 4. How review scheduling works

The app uses a lightweight spaced-repetition schedule:

- Again: 10 minutes and lower ease
- Hard: short interval and slightly lower ease
- Good: 1 day, then 3 days, then grows with ease
- Easy: 2 days, then 5 days, then grows faster

The exercise type becomes more demanding as mastery increases.

## 5. Phrase generation

The Phrase Lab uses saved vocabulary and conservative templates such as `Это X.`, `Вот X.`, and `Где X?`. It also sometimes surfaces phrases that you personally entered. It intentionally avoids pretending that a simple template engine is a complete Russian grammar engine.

## 6. Vocabulary-level estimate

The app's first version uses approximate Russian-as-a-foreign-language vocabulary milestones:

- A1: 780
- A2: 1,300
- B1: 2,300
- B2: 5,000
- C1: 9,000
- C2: 12,000 (working app milestone, not an official certification threshold)

Vocabulary count alone cannot certify a CEFR level. The app should therefore be treated as a progress indicator, not a language certificate.

## 7. Backup

Settings → Export JSON creates a backup. Settings → Import JSON can restore it.
