# Russian Learner 2.0

A free, Duolingo-inspired Russian learning web app built around vocabulary that YOU enter.

## What is included

- Personal course path generated from your vocabulary topics
- Adaptive review queue with spaced repetition
- Multiple-choice, translation, typing, word-bank, listening, fill-in, and speaking challenges
- Free browser text-to-speech in Russian
- Free browser speech-recognition speaking practice where supported
- Reading/listening passages with comprehension questions
- XP, daily goal, streak, gems, achievements, league-style personal board
- Progress dashboard and adaptive Russian Score estimate
- Search/filter/import/export vocabulary
- Local browser persistence
- Optional Supabase account and cloud sync
- PWA manifest + service worker for installable/offline shell
- Static deployment on GitHub Pages

## Free-stack limits

No paid AI API is required. The app uses local JavaScript for phrase generation and scheduling and Web Speech APIs for audio/speaking. SpeechRecognition support is limited by browser; Chrome/Edge is the recommended desktop path. Recognition may use a browser/platform service depending on the environment and is not guaranteed offline.

## Supabase

1. Keep the existing Supabase project from Russian Learner 1.x.
2. Run `supabase.sql` in SQL Editor.
3. Keep your existing browser-safe Supabase URL/key in `config.js`.
4. Never put a Supabase secret/service-role key in the site.

## GitHub Pages

Replace the files in your existing public repository with the files from this folder, keeping your working `config.js` values. Publish from `main` + `/ (root)`.

## Important

This project aims for feature parity in learning mechanics, not a copy of Duolingo's proprietary source code, assets, characters, text, or backend. It is an original implementation using free browser and hosting capabilities.
