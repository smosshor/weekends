# Weekends

See your year one weekend at a time, with Month and Week views, straight from Google Calendar.

**Live site:** https://smosshor.github.io/weekends/

- Sign in with Google; plans are read and saved directly between your browser and Google Calendar.
- Weekends view (Fri/Sat/Sun), Month and Week views, drag plans between days, themes, share links (optionally read-only).
- On a phone: open the site, then Share → Add to Home Screen.

## Files
- `index.html`, `app.css`, `app.js`: the app
- `calendar-api.js`: Google Calendar read/write
- `config.js`: the Google OAuth Client ID (public)
- `theme.js`: applies the saved theme and loads Google sign-in

## Access
While the Google Cloud app is in Testing, only Gmail addresses listed as test users can sign in
(Google Cloud console → Google Auth Platform → Audience → Test users).
