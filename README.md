# Live Transcribe

A single-page, no-backend live speech-to-text display. Open it on an iPhone in Safari,
tap **Start listening**, and speech appears in large letters as it is spoken.

Built for someone hard of hearing: giant text, few controls, dark room-friendly styling,
and a Home Screen shortcut that runs full screen.

## How it works

* Uses Safari's built-in `webkitSpeechRecognition` (Web Speech API), language `en-GB`.
* iOS ends recognition after silence or roughly a minute, so the page restarts it
  automatically and keeps the text that is already on screen.
* Requests a Screen Wake Lock (iOS 16.4+) so the display stays on while listening.
* No server, no accounts, no API keys, no data stored. Audio is sent to Apple's
  speech service, so it needs an internet connection.

## Files

```
index.html            markup
styles.css            layout and themes
app.js                recognition, restart logic, UI
manifest.webmanifest  Home Screen / PWA metadata (landscape)
icons/                app icons
```

## Test locally

The microphone requires a secure context; `localhost` counts.

```sh
cd RTT
python3 -m http.server 8000
```

Open <http://localhost:8000> in desktop Chrome or Safari to check the UI. Speech
recognition on desktop Chrome uses Google's service, so it is handy for quick tests.

For iPhone testing you need HTTPS — deploy to GitHub Pages (below) and open the
real URL. Safari refuses microphone access over plain `http://` on a LAN address.

## Deploy to GitHub Pages

The repository must be **public** on a free GitHub plan.

```sh
git init -b main
git add .
git commit -m "Live Transcribe"

# after creating an empty public repo named e.g. live-transcribe
git remote add origin https://github.com/<you>/live-transcribe.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch
→ Branch: `main`, folder `/ (root)` → Save**.

The page appears at `https://<you>.github.io/live-transcribe/`.

## Set up the iPhone

1. Open the URL in **Safari** (not Chrome — third-party browsers on iOS do not expose
   the speech API).
2. Allow the microphone when asked.
3. Tap **Share → Add to Home Screen**. Launching from the icon gives a full-screen,
   toolbar-free view; the manifest asks for landscape.
4. Recommended: **Settings → Display & Brightness → Auto-Lock → Never**, or 5 minutes
   at most, so the screen does not sleep mid-conversation. (The wake lock covers most
   cases, but the phone still wins when it wants to.)

## Using it

* **Start listening** — begins transcription.
* **A− / A+** — four text sizes. The choice is remembered.
* **Pause / Resume** — stops the mic without leaving the screen.
* **Clear** — wipes the transcript.
* **Stop** — ends the session and returns to the start screen.
* Controls fade out after a few seconds; tap anywhere to bring them back.

## Notes and limits

* Requires iOS 14.5+ and an internet connection.
* Accuracy depends on distance, background noise and accent. Speak at a normal pace
  from within about a metre.
* Punctuation and capitalisation are produced automatically by Apple's service.
* The screen must stay on; iOS will not let a web page listen in the background.
* To change the recognition language, edit `LANG` at the top of `app.js`
  (e.g. `en-US`, `en-AU`). The `lang="en-GB"` in `index.html` only affects page semantics.
* Diagnostics: open **Info** at the bottom of the start screen to see the detected iOS
  version, whether the speech API and wake lock are available, and the user agent.

## Troubleshooting

**"Microphone blocked"** — tap the `aA` button in Safari's address bar →
Website Settings → Microphone → Allow, then Resume.

**Nothing happens after Start** — confirm the page is open in Safari, not an in-app
browser (links opened from Messages/Mail sometimes stay inside another app). Copy the
URL into Safari.

**Stops after a while** — it should restart itself; the status pill shows
"Reconnecting…". If it pauses, tap **Resume**.
