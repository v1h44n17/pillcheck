# PillCheck: Devpost submission

**Submitted 16 Nov 2026:** https://devpost.com/software/pillcheck-wexj9t

> Paste each section into the matching Devpost field. Every number below is either measured in this repo or cited in the README's [Why](../README.md#why) section.

## Submission checklist (deadline 1 Dec 2026, 03:30 IST; aim for 30 Nov, 18:00 IST)

Done and verified (15 Nov 2026):
- [x] **Public repo with Apache 2.0:** https://github.com/v1h44n17/pillcheck (author emails use the GitHub no-reply address).
- [x] **Secret scan:** gitleaks found no leaks in all 17 commits. Every past version of every file was also checked against the real config values, and none appear. The env files are not in the repo.
- [x] **Live app:** https://pillcheck-by-v1h44n.web.app matches the latest code. It has security headers and a CSP, and App Check is enforced (no token gets 401 from Gemini and 403 from Firestore).
- [x] **Tests:** 231 unit and 12 security-rules tests passing, and the code type-checks.
- [x] **Text description:** this file.

Also done:
- [x] **Video:** recorded from real runs of the live site, uploaded to YouTube with English subtitles: https://youtu.be/q3ZRySaiAMg
- [x] Video link added below and in the README.
- [x] Devpost filled in: every section below, both links, the video and 6 screenshots from the recorded run.
- [x] **Submitted** and checked logged out: https://devpost.com/software/pillcheck-wexj9t
- [ ] *Note:* `npm audit` lists 4 "high" advisories in `@grpc/grpc-js`. That is Firestore's Node.js transport, and it is **not in the browser bundle** (checked). The suggested fix would downgrade Firebase to v9, so it was not applied.

**Tagline (≤ 200 characters):**
Press one button, ask out loud if two pills are safe together, and hear a calm answer. Your voice and name never leave your computer. Only drug names reach the cloud.

**Links**
- Live app: https://pillcheck-by-v1h44n.web.app (Chrome desktop with Gemini Nano)
- Code: https://github.com/v1h44n17/pillcheck
- Video: https://youtu.be/q3ZRySaiAMg (2:02, English subtitles)

---

## Inspiration

Meera is 74, lives alone and takes five medicines, one of them warfarin. Her knee hurts. Can she take Advil? The leaflet print is tiny and her daughter isn't answering, so she guesses.

She isn't unusual:
- About **1 in 6 older Americans** is at risk of a potential major drug–drug interaction, and over a third take five or more prescription medicines at once (Qato et al., *JAMA Internal Medicine* 2016).
- Adults 65+ visit US emergency rooms for adverse drug events **more than 600,000 times a year**, and blood thinners are the leading cause (CDC).

An AI assistant can answer that question in seconds. The problem is what it needs to hear: her voice, her name, her medicines and her health worries. The people who most need this are also the people with the most reason not to send all of that to a server.

So the question I built around was: **what if the cloud only ever saw the drug names?**

## What it does

Meera presses one big button and says *"Can I take Advil?"* A few seconds later she hears *"Please don't take Advil with your Coumadin because combining them can cause serious bleeding. Please check with your doctor or pharmacist first before adding this medicine."* (the exact answer from the recorded demo run)

Under the hood, each step is pinned to one place on purpose:

| Step | What | Where |
|---|---|---|
| 1 | Hear the question | **On device**: Chrome speech recognition with `processLocally` |
| 2 | Pull out the drug names | **On device**: Gemini Nano via Firebase AI Logic, `ONLY_ON_DEVICE` |
| Guard | Only known drug names may leave | **On device**: leak guard |
| 3 | Check the interaction | **Cloud**: Gemini via Firebase AI Logic, `ONLY_IN_CLOUD`, grounded in FDA labels |
| 4 | Speak the answer | **On device**: local voice |
| 5 | Audit log | **Cloud**: Firestore, with no personal data |

What makes it trustworthy:
- **The leak guard.** Whatever Nano extracts, the cloud only gets *canonical ingredient names from a closed list* built from openFDA. "Advil" becomes `ibuprofen` and "Coumadin" becomes `warfarin`. A name, a birthday or a dose is blocked, and PillCheck says so out loud: *"Stopped before sending. Nothing left this device."*
- **Her names come back on the device.** The cloud sees `warfarin`, and she hears "Coumadin".
- **It fails closed.** If the computer can't run the private steps locally, PillCheck says *"I can't check safely on this device"* and sends nothing. It never quietly moves a private step to the cloud.
- **A live provenance strip** shows where each step ran (🔒 This device / ☁️ Cloud). A **privacy receipt** lists, in plain language, everything that has ever left the computer.
- **My medicines** are added by voice, stored only in the browser, and included in every check.
- **Built for a 74-year-old:**
  - one 7rem button;
  - the Atkinson Hyperlegible typeface;
  - WCAG AAA (7:1) contrast, enforced by a test;
  - answers of three sentences at most, written to be heard;
  - a "Did you mean Coumadin?" button when a name is misheard.

## How I built it

- **Firebase AI Logic hybrid inference** (`firebase@13.3.0`):
  - `InferenceMode.ONLY_ON_DEVICE` for Step 2, with a JSON Schema `responseConstraint` so Nano must return `{"medicines": [...]}`;
  - `ONLY_IN_CLOUD` for Step 3, with a `responseSchema` (verdict, spoken text, interactions).
- **The routing policy is code** (`src/pipeline/policy.ts`). The UI labels, the audit log and the tests all read from it.
- **Firebase App Check, enforced.** reCAPTCHA Enterprise protects AI Logic and Firestore, and AI Logic uses limited-use tokens. I verified it on the live site: a Gemini request with a missing or forged token gets `401`.
- **Firestore audit log.** It holds only fixed status words, finding *types*, and the drug names that were actually sent. Security rules make it owner-only, append-only and schema-checked. They even refuse a record claiming Step 2 ran in the cloud. 12 emulator tests cover the rules.
- **Remote Config** tunes the cloud models, the answer length, the listening time and a kill switch. By design, no key can move a step between device and cloud, disable a guard, or widen what is sent.
- **Grounding:** Step 3 fetches the interaction, boxed-warning and older-adult sections of the official FDA label (openFDA) for each drug. Gemini answers from those first.
- **Hosting:** Firebase Hosting with a strict Content Security Policy. The page can only contact Firebase and openFDA, and the browser refuses everything else.
- **Stack:** React + TypeScript + Vite, with 231 Vitest unit tests.

## Challenges I ran into

- **`ONLY_ON_DEVICE` isn't a guarantee.** Reading the SDK source, I found that when Chrome's `LanguageModel` API is missing, the request quietly goes to the cloud *even in `ONLY_ON_DEVICE` mode*. I wrote a test against the real SDK that proves it: a transcript with a patient's name reaches the cloud endpoint. PillCheck therefore checks Nano is ready **before** every on-device call and checks `inferenceSource` **after** it. Anything uncertain means refusal.
- **On-device audio isn't supported** by the Firebase hybrid SDK. So Step 1 uses Chrome's on-device speech recognition. PillCheck verifies that `processLocally` really is on, and treats any network error as a refusal instead of a retry.
- **"Can I take Behind Patel?"** That's what the local recogniser first heard for "Advil". I fixed it with Chrome's contextual-biasing phrases: her own medicines get the strongest boost, then common ones. The "Did you mean…?" button is a backstop. It has a test that ~30 common first names and surnames are never "corrected" into a drug.
- **Store brands.** "Equate" and "CVS" sell dozens of different drugs under one name. The lexicon builder keeps a brand only if every product under it has the same ingredients.
- **I found a secret in my own bundle before I shipped it.** A config default had been inlining every `VITE_*` value into the production bundle, including the App Check debug token. I caught it before the first deploy, and a test now fails on the old code.
- **A 110-second hang.** My safety evaluation found that Step 3 had no timeout. Now each cloud model gets 15 seconds and each label request 6. After that comes the backup model, then *"ask your pharmacist"*.

## Accomplishments that I'm proud of

- **Safety evaluation: 30 of 30.** I ran 20 dangerous pairs (warfarin + ibuprofen, sildenafil + nitroglycerin, oxycodone + alprazolam…) and 10 safe ones through the full live pipeline. There were **0 missed dangers and 0 over-warnings**, at 2.5–4.5 s per answer.
- **The privacy promise is checked in four independent places:**
  - the leak guard;
  - a second guard inside Step 3, right before the network;
  - the audit builder, which only accepts a closed vocabulary;
  - Firestore security rules.
- **The demo can't be faked into leaking.** Its switches (`?simulate=…`) can only take capabilities away, never add one.
- **Lighthouse accessibility 100**, and AAA contrast in light and dark mode.

## What I learned

- Hybrid AI isn't "on device when you can, cloud when you must". For sensitive data, the useful version is "**this step on device, always, or not at all**", and you have to enforce that yourself.
- The cheapest privacy technique was not sending the data at all. The cloud model works just as well on `["ibuprofen", "warfarin"]` as on the sentence Meera said.
- Designing for an older user changed my engineering choices, not just the CSS. Examples: answers that fit in three spoken sentences, two taps to remove a blood thinner, and spoken refusals so she always knows why nothing happened.

## What's next for PillCheck

- More languages for speech and voice, starting with Hindi.
- A pharmacist-reviewed evaluation set, much larger than 30 pairs.
- A Chrome extension so a family member can set it up once on Meera's computer.
- Reminders from the on-device medicine list, which never leaves the device.

PillCheck is not medical advice. It always tells people to check with their pharmacist or doctor.

## Built with

`firebase-ai-logic` · `gemini-nano` · `gemini` · `chrome-built-in-ai` · `prompt-api` · `web-speech-api` · `firebase-app-check` · `recaptcha-enterprise` · `cloud-firestore` · `firebase-remote-config` · `firebase-authentication` · `firebase-hosting` · `openfda` · `react` · `typescript` · `vite` · `vitest`
