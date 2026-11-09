# FormVault

**Your projects, hackathons and achievements in one private vault, so you can fill any form from it.**

FormVault is a free, open-source browser extension for students. You connect your scattered history once: LinkedIn, ChatGPT/Claude/Gemini chats, GitHub, Devpost, your resume and certificates. FormVault builds a vault from it. When you open a hackathon or application form, it drafts every answer from that vault. You review the drafts, click **Fill**, and press Submit yourself.

- **No server.** The vault stays in your browser. You can export it as a file, lock it with a password, or sync it to a hidden folder in your own Google Drive.
- **Free.** You bring your own free Gemini key. Each form takes one AI call, and personal details never go to the AI.
- **Gets better with use.** It saves the answers you approve and reuses them on similar questions. It also learns your writing style from the edits you make.

## Features

| | |
| --- | --- |
| **Quick add** | One box for everything. Drop files (several at once), paste text, paste a screenshot with Ctrl+V, or paste a link. FormVault works out what each thing is: resume, certificate, LinkedIn or chat export, GitHub or Devpost profile, Google Doc, or any public page. Files you already imported are skipped so they don't use your AI quota twice. |
| **Reads images for free** | Screenshots, certificate photos, posters and scanned PDFs are read with OCR **on your computer** (Tesseract, bundled, works offline). Only the recognised text goes to the AI, with your contact details removed. The image itself is sent only if OCR finds almost nothing, for example on a very stylised certificate. |
| **Import once** | LinkedIn data export · ChatGPT, Claude and Gemini exports · resume (PDF, Word or scanned) or linked Google Doc · GitHub username · Devpost profile · certificate PDFs and photos |
| **Inbox** | Every find is a proposal. Duplicates are merged, so three chats about one hackathon become one entry. Nothing enters the vault until you approve it, and every approve or dismiss can be undone. |
| **Stays up to date** | GitHub, Devpost and a linked resume re-sync once a day. "Add to vault?" chips appear on LinkedIn, AI chats, Gmail and Outlook. You can also select text on any page, or right-click any image, and choose *Add to FormVault*. The toolbar icon shows how many finds are waiting. |
| **Fill** | Works on normal forms, Google Forms, forms inside iframes, ARIA widgets (Typeform-style) and React sites. Profile fields are filled locally. Everything else is drafted in **one** AI call. Each draft shows its source: *From vault: Project X*, *Your approved answer from …*, or *Not in your vault*. |
| **Answer memory** | Approved answers are matched by meaning (embeddings) and adapted to new word limits. Questions like "Which project are you proudest of?" show cards to pick from. "List your hackathons" shows a ticked checklist. |
| **Privacy** | Emails, phone numbers, ID numbers and your name are stripped before any text goes to the AI. FormVault reads a page only after you click its icon, and it never presses Submit. |

## Install for testing (Firefox first)

```bash
npm install
npm run build          # Firefox (MV3) → .output/firefox-mv3
```

1. Open `about:debugging#/runtime/this-firefox` in Firefox 128 or newer.
2. Click **Load Temporary Add-on…** and choose `.output/firefox-mv3/manifest.json`.
3. The welcome tab opens. Paste a free Gemini key from [Google AI Studio](https://aistudio.google.com/app/apikey).
4. Import something, approve it in the **Inbox**, then open a form and click the FormVault toolbar icon (or press **Alt+Shift+F**).

For live reloading while you develop, run `npm run dev`. It launches Firefox with the extension loaded.

Other browsers: `npm run build:chrome` (Chrome and Brave) and `npm run build:edge`. In Chrome, load `.output/chrome-mv3` from `chrome://extensions` with Developer mode turned on.

### Firefox notes

- The panel opens in Firefox's **sidebar**. Clicking the toolbar icon opens the sidebar and gives FormVault one-time access to read that tab.
- MV3 add-ons in Firefox may ask you to allow site access. If an import says it can't reach a site, go to `about:addons` → FormVault → **Permissions** and turn on the listed sites.

## Getting your data out of other sites

| Source | How |
| --- | --- |
| LinkedIn | Settings → Data privacy → [Get a copy of your data](https://www.linkedin.com/mypreferences/d/download-my-data). Pick the larger archive so your posts are included. |
| ChatGPT | Settings → Data controls → Export data |
| Claude | Settings → Privacy → Export data |
| Gemini | [Google Takeout](https://takeout.google.com/) → *My Activity* → Gemini Apps |

## Development

```bash
npm run compile   # type-check
npm test          # unit + DOM tests (vitest, happy-dom)
npm run zip       # Firefox zip + sources zip for AMO
npm run zip:chrome
```

Stack: [WXT](https://wxt.dev) (Manifest V3), React and TypeScript. One codebase builds for Firefox, Chrome, Edge and Brave. OCR uses [Tesseract.js](https://github.com/naptha/tesseract.js); its WebAssembly engine and English data (about 7 MB) are copied into the build from `node_modules`, so nothing is downloaded at run time.

```
src/
  entrypoints/
    background.ts        icon click → open panel + inject reader, daily sync, right-click capture
    formreader.ts        injected on demand: scans fields, fills them, never submits
    capture.content.ts   "Add to vault?" chips
    sidepanel/ welcome/  the UI
  lib/
    ai/                  providers (Gemini, OpenAI, Claude, on-device), prompts, rate-limit retry
    import/              Quick-add router, OCR, images, links, LinkedIn, chats, resume, GitHub, Devpost
    fill/                profile matching, answer memory, picks, one-call drafting, learning
    inbox.ts             proposals, duplicate merging
    backup.ts drive.ts   export/import (AES-GCM) and Google Drive app-folder sync
  ui/                    React views
```

### Google Drive sync

Drive sync needs a Google OAuth client ID, which is free to create. Create a client of type *Web application* in Google Cloud Console. Add the redirect URI shown in Settings → Drive sync, which is `browser.identity.getRedirectURL()`. Then either build with `WXT_GOOGLE_CLIENT_ID=<id> npm run build`, or paste the ID into Settings.

## Privacy policy

See [docs/index.html](docs/index.html). It is published with GitHub Pages so the store listings can link to it.

## License

MIT
