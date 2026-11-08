# FormVault — Extension Build Plan

Nov 9, 2026 · @Zodarc

## What it is

FormVault is a free browser extension that turns your scattered history into one vault, then fills forms from it. The import is the product, and form filling is the payoff.

Your projects and hackathons already exist, spread across LinkedIn posts, AI chats, GitHub repos, emails and old forms. FormVault collects them once and keeps collecting as you go, so you never upload the same thing twice.

The 30-second version:

1. Install it and connect your sources once: LinkedIn and AI-chat exports, your GitHub username, your resume.
2. FormVault builds the vault and shows what it found, such as "9 projects, 6 hackathons, 3 awards". You tick what's right.
3. From then on it keeps itself up to date. When you post on LinkedIn about a new hackathon, a small chip asks "Add to vault?"
4. On a form, you click the icon. Answers come from the vault and from answers you've already approved. You review them and click Fill.

Every form you fill makes the next one faster, because FormVault remembers the answers you approved and the edits you made.

## What already exists

AI form fillers are common, so the import is what sets FormVault apart. Every tool below assumes you already have a tidy profile or resume to give it. None of them builds one from your scattered history.

| Tool | What it does | What it lacks |
| --- | --- | --- |
| [Simplify Copilot](https://simplify.jobs/copilot) | Fills job applications on 100+ job portals; free, with paid AI answers | Jobs only, with no focus on hackathons or Google Forms |
| [Auto Form Filler](https://extpose.com/ext/397981) | Uses your own free Gemini key and a local profile to fill any form | You type the profile yourself |
| [Superfill.ai](https://hn-svelte.vercel.app/item/46134574) | Open source, uses your own key, matches stored "memories" to fields | No import from LinkedIn or chats |
| [FillMate](https://chromewebstore.google.com/detail/fillmate-%E2%80%94-ai-form-fill-o/fabdemkkeajlfmhiopnjhdoajpdalijn) | Answers questions from a resume or notes you upload | One static knowledge file |
| [Donbrico Autofill AI](https://chromewebstore.google.com/detail/donbrico-autofill-ai/ldglmpphcjdamkmfpknojafocpihhbal) | Runs on Chrome's built-in on-device AI by default | You still type the profile by hand |

Most of these have very few users, so no tool has clearly won this space yet.

## Getting everything in, once

You connect each source once. After that, FormVault either syncs it by itself or catches new things as you browse, so nothing is ever uploaded twice.

| Source | First time | Stays updated by |
| --- | --- | --- |
| LinkedIn | Upload the data export, which has all your posts | A chip on your own new posts and activity page: "Add to vault?" |
| ChatGPT, Claude, Gemini chats | Upload each app's export | A chip in chats that mention a project or hackathon |
| GitHub | Type your username | Auto-sync of your public repos: name, description, README, languages, dates |
| Devpost | Paste your profile link | Re-checking your public profile for new hackathons and projects |
| Resume | Upload the PDF, or link a Google Doc | Re-reading the linked Google Doc when it changes |
| Email (Gmail, Outlook) | Nothing needed | A chip on emails you open, such as "You've been selected" or results |
| Certificates | Upload PDFs or images | The same chip on certificate pages and emails |
| Forms you fill | Nothing needed | New facts you type into any form (see Answer memory) |
| Anything else | Paste box | Selecting text on any page, then right-click "Add to FormVault" |

**The Inbox.** Nothing enters the vault without your OK. Every find lands in an Inbox as a proposed change. It's either a new entry, such as "New hackathon: NASA Space Apps 2025", or an update, such as "Project X: add 'won 2nd place'". You approve each with one tap. FormVault merges duplicates, so three chats about one hackathon become one entry.

**Cost control.** Big exports are filtered in the browser first, keeping only text that mentions words like hackathon, project, built, won or deployed. Only those parts go to the AI, in a few large batches.

**Limits to know:**

- LinkedIn and the AI-chat sites have no public API for this. So the chips read only pages you open yourself, and only when you tap them. Reading these sites automatically in the background would break their terms.
- Reading all of your Gmail through Google's API requires a paid security review for public apps. So email uses the on-page chip instead.

## Decisions so far

Version 1 has no server at all: the vault stays in the user's browser, and each user brings their own free Gemini key.

| Decision | Choice | Why |
| --- | --- | --- |
| Where the vault lives | In the browser (`chrome.storage.local`), plus export/import as a file | Free, private, nothing to host |
| AI | The user's own key: Gemini by default, or OpenAI or Claude | Gemini has a free tier |
| Default model | Gemini Flash-Lite, with Flash as a fallback | Flash-Lite has the most free daily requests |
| Browser | Chrome first; also works in Edge and Brave, which are built on the same engine | Most users are covered |
| Server | None in v1 | No cost, no logins, and nothing that can leak |

**Is Gemini free? Yes, with limits.** The free tier covers the Gemini 3.x Flash and Flash-Lite models and needs no credit card. Pro models are paid only. Google doesn't publish exact free limits; each project sees its own in Google AI Studio. Developers report about 20 requests a day for Flash and about 500 a day for Flash-Lite ([source](https://agentdeals.dev/gemini-api-pricing-2026)).

Two design rules follow from that:

- **One AI call per form, not one per question.** All questions go in a single request, so even 20 requests a day is 20 forms.
- **Personal details never go to the AI.** On the free tier Google uses prompts to improve its products, human reviewers may read them, and Google advises against sending personal information. So name, phone, email and CNIC are filled locally with no AI call. Only project and hackathon write-ups are sent. Users in the EU, Switzerland and the UK need a paid key ([source](https://agentdeals.dev/gemini-api-pricing-2026)).

## How it works

The extension has four parts, all inside the browser. Only the AI request leaves the browser.

&#91;embedded content: FormVault architecture · 4 parts in the browser, 1 outside\]

The side panel asks the form reader to scan the page. It passes the questions to the background worker, which adds your vault and makes one call to Gemini. The drafts come back to the panel, and after you approve them the form reader types them in.

## The vault

The vault is one JSON object saved in the browser. Every entry has an id, a "last updated" date, and a record of where it came from (a LinkedIn post, a chat, a form).

| Section | Fields per entry | Goes to the AI? |
| --- | --- | --- |
| Profile | Name, email, phone, CNIC (optional), university, roll no, CGPA, LinkedIn, GitHub, portfolio, city | No, filled locally |
| Projects | Title, dates, your role, tech stack, problem, what you built, result, links, a 1–2 line summary, a longer description | Yes |
| Hackathons | Name, organiser, date, team members, which project you built (links to Projects), result or prize, LinkedIn post link | Yes |
| Experience | Organisation, role, dates, what you did | Yes |
| Achievements | Title, date, issuer, link (awards, certificates, competitions) | Yes |
| Skills | Languages, frameworks, tools | Yes |
| Answer memory | Each approved answer: question, site, word limit, final text, vault entries used, how much you edited it | Yes, for reuse |
| Writing style | Rules learned from your edits, such as "first person, no buzzwords" | Yes, with every draft |
| Inbox | Proposed new entries and updates waiting for your OK | Only when sorting new finds |

A hackathon links to its project instead of repeating it, so you write each project once.

## First-time setup

The aim is under three minutes from install to a usable vault, with no technical words on screen.

1. **Install** from the Chrome Web Store with one click. A welcome tab opens by itself.
2. **Get a free key.** A big button labelled "Get my free key" opens Google AI Studio's key page in a new tab. Beside it, a 20-second clip shows the three clicks: sign in with Google, click Create API key, click Copy.
3. **Paste it.** The welcome tab has one paste box and no Save button. The moment a key is pasted, FormVault tests it and shows a green tick, or a plain-language fix such as "This key was copied incompletely, try copying again."
4. **Fill the vault** in one of three ways:
   - paste anything (a resume, a LinkedIn post, notes) and let the AI sort it into the right sections
   - import exports from LinkedIn or AI chats (see Getting everything in, once)
   - type it in with simple forms
5. **Done.** The welcome tab points to the icon: "Next time you see a form, click me."

The key is stored only in the user's browser and is sent only to Google.

## Filling a form

One click reads the form. Answers you've already approved are reused first, and one AI call covers the rest. Nothing goes into the page until you approve it.

1. **Open.** You click the icon or press a shortcut such as Ctrl+Shift+F, and the side panel opens beside the form.
2. **Scan.** FormVault finds every field (text boxes, big answer boxes, dropdowns, radio buttons, checkboxes) and works out each field's question from its label or the text near it. Google Forms gets special handling because its questions sit in custom blocks.
3. **Instant fills.** Basic fields such as name, email, phone, GitHub and university are filled from your Profile directly, with no AI call.
4. **Match memory.** Each remaining question is checked against your Answer memory. A question you've answered before brings back your approved answer. A question that asks you to pick from your history shows cards or a checklist from the vault (see Answer memory).
5. **One AI call.** Everything else goes to Gemini in one request, together with the relevant vault entries and your Writing style rules. That includes reused answers that need adapting to a new word limit.
6. **Review.** Each draft shows where it came from: "Reused from Hackathon 1", "From vault: Project X", or "Not in your vault" instead of a made-up answer. One-tap buttons make an answer shorter, longer or more formal, or add numbers, so there's no chat back and forth.
7. **Fill.** One click writes the answers into the page in a way the form recognises, so sites built with tools like React register them. FormVault never presses Submit.
8. **Learn.** Approved answers go into Answer memory, your edits become Writing style rules, and new facts you typed go to the Inbox.

Hard cases to plan for:

- forms that span several pages, which need a fresh scan on each page
- custom widgets on sites like Typeform
- forms embedded inside another page (an iframe)
- file uploads, which FormVault skips and points out to you

## Answer memory

Once you approve an answer, FormVault reuses it, so you never fix the same thing twice.

**Every approved answer is saved** with the question, the site, the word limit, your final text, the vault entries it used, and how much you edited it.

**Similar question on a new form.** For each new question, FormVault looks for past questions that mean the same thing, even when they're worded differently. It compares meaning rather than exact words, using text embeddings, which Gemini offers on its free tier.

- **Same question, same limit:** your old answer is offered as it is, labelled "Your approved answer from Hackathon 1".
- **Different limit,** for example 1000 words before and 300 now: it shortens or extends your old answer and keeps your own sentences wherever it can, instead of writing from scratch.
- **Nothing similar:** a fresh draft from the vault.

**Pick-from-your-vault questions.** A question like "Describe your best idea" or "Which project are you proudest of?" shows your matching vault entries as cards, best match first. You pick one, and the answer is written from it. A question like "List your past hackathons" shows a checklist of all of them, already ticked, and you untick any you want to leave out.

**Learning from your edits.** When you edit a draft, FormVault notes what you changed and saves it as a lasting rule in your Writing style, for example "first person, no buzzwords" or "always mention team size". Every later draft follows those rules. The goal is drafts you accept without editing, and the panel tracks how often that happens.

**Updates from forms.** You might type something into a form that the vault doesn't have, or that contradicts it, such as a new CGPA or a project it doesn't know about. After filling, FormVault offers to save it: "Update CGPA from 3.4 to 3.5?"

## Sharing it with everyone

Anyone can install it from the Chrome Web Store, and each person gets their own private vault. No vault is shared between users.

- **Store listings.** Chrome Web Store through a group publisher that a friend owns, so their one-time $5 fee covers it. Edge Add-ons and Firefox Add-ons are free. The listing needs a privacy policy page because the extension handles personal data. A one-page site on GitHub Pages is enough.
- **Open source on GitHub.** People are being asked to trust it with their details and an API key. Public code lets them check that nothing is sent anywhere except to Google, and it also makes a strong portfolio piece.
- **Your vault on another browser or account.** Export the vault as a file, optionally locked with a password, and import it on the other side. This is what fixes your "logged in from another account" problem.
- **Automatic sync.** Saving the vault to the user's own Google Drive, in a hidden app folder, syncs it everywhere and still needs no server of ours.
- **Asking for little.** The extension only reads a page when you click the icon, and never in the background. That keeps the install warning mild and builds trust.

## Build phases

Everything below is in scope. Import comes first because it's the product. Each phase ends with something you can test on your own real history and forms.

| Phase | What ships | Done when |
| --- | --- | --- |
| 1. Import | Paste box; LinkedIn, AI-chat and resume import; GitHub and Devpost sync; the Inbox with duplicate merging; a vault editor | Your real history becomes a vault without you typing it |
| 2. Fill | Key setup for Gemini, OpenAI or Claude; scan; instant fills; one AI call; review panel; Fill on normal forms and Google Forms | You fill a real hackathon form from the vault |
| 3. Answer memory | Saved answers, meaning-based matching, adapting to word limits, pick-from-vault cards and checklists, Writing style learning, updates from forms | A second hackathon form reuses the first one's answers with no edits |
| 4. Capture as you go | Chips on LinkedIn, AI chats and email; right-click add; linked Google Doc resume | A new LinkedIn post reaches the vault in one tap |
| 5. Every form and sync | Multi-page forms, Typeform-style widgets, forms inside other pages, Google Drive sync, password-locked export | It works on a test list of 15 real forms, and on a second browser |
| 6. Ship everywhere | Welcome flow, privacy policy page, public GitHub repo, listings on Chrome, Edge and Firefox | A friend installs it and builds their vault without your help |

Tech stack: a Manifest V3 extension built with WXT, React and TypeScript. WXT builds the Chrome, Edge and Firefox versions from one codebase. There is no backend.

## Your call

These are the choices I made on my own. Change any of them and I'll build to your version.

- [x] **Name.** Keep "FormVault" or pick another?
- [x] **Side panel or popup?** The plan uses a side panel so you can see the form and your answers at once. A popup is simpler but closes when you click away.
- [x] **Instant fills.** Should name, email and the like be filled with no review, or shown in the review list too? should be in the review list as can be that there are team members etc
- [x] **Phase 1 scope.** All websites from day one, or Google Forms only first? Google Forms only is faster to build and covers most hackathon forms.
- [x] **Password-lock the vault?** It's safer if someone else uses your laptop, but it's one more step every time you open it.
- [x] **Stack.** React and TypeScript as planned, or plain JavaScript so it's easier for you to read and change?

* [x] **On-device AI by default?** Chrome's built-in model needs no key and keeps everything on the computer, but it only runs on newer, stronger machines. Your own key would be the fallback.
