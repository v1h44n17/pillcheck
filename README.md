# PillCheck

**Press one big button, say the name of a pill, hear a calm answer.**
PillCheck is a voice-first medication safety checker for seniors, built on **Firebase AI Logic hybrid inference**. Anything that could identify you stays on your device. Only a cleaned list of drug names ever reaches the cloud.

> Status: **Day 8 of 17**: all five steps run through one [pipeline](src/pipeline/orchestrator.ts), and Meera has **her own medicine list** (added by voice, kept on her device), so "Can I take Advil?" is checked against everything she already takes. See [docs/PLAN.md](docs/PLAN.md).
> Built for #BuildHybridAI 2026. Licensed under [Apache 2.0](LICENSE).

---

## Why

Meera is 74, lives alone and takes five medicines. When she isn't sure two pills are safe together, she calls her daughter (who may not answer) or skips the dose. Skipped and mixed-up doses send seniors to the hospital every day.

*Evidence (⚠️ figures pending source verification on Day 15; not yet for publication):*
- Seniors account for a disproportionate share of medication errors.
- Home medication errors drive a large number of ER visits each year.
- Adverse drug events among seniors cause hundreds of thousands of hospitalizations a year.
- Nonadherent elderly patients have roughly double the inpatient cost of adherent ones.

## How hybrid inference is used: the routing policy

The routing policy is the product. Each step is pinned to one place, on purpose. Nothing falls back to the cloud silently. The policy lives in code at [`src/pipeline/policy.ts`](src/pipeline/policy.ts), and the UI's "Heard on this device" style labels come from it.

| Step | What | Where | Firebase AI Logic mode | Leaves the device? |
|---|---|---|---|---|
| 1 | Hear the question | Chrome on-device speech recognition (`processLocally: true`) | n/a (browser API) | **No.** Audio and transcript stay local |
| 2 | Pull out drug names | **Gemini Nano** | `InferenceMode.ONLY_ON_DEVICE` | **No** |
| (guard) | Leak guard scans the outbound payload | Local code | n/a | Blocks anything that isn't a known drug name |
| 3 | Check interactions, write 1–3 spoken sentences | **Cloud Gemini** | `InferenceMode.ONLY_IN_CLOUD` | Yes: **drug names only** |
| 4 | Speak the answer | `speechSynthesis` (local voices) | n/a | No |
| 5 | Audit log | Firestore | n/a | Timestamp, drug names, where each step ran, leak-guard result. No audio, no PII |

### Fail-closed, not fail-open
If on-device AI isn't available, PillCheck says **"I can't check safely on this device"** and stops.

> **Verified SDK behaviour (firebase@13.3.0 / @firebase/ai@3.1.0):** the SDK only creates its on-device adapter when `globalThis.LanguageModel` exists. If it doesn't, `callCloudOrDevice()` sends the request **to the cloud even in `ONLY_ON_DEVICE` mode**. [`tests/sdkFallthrough.test.ts`](tests/sdkFallthrough.test.ts) proves it against the real SDK: a transcript containing a patient's name is sent to `firebasevertexai.googleapis.com`, and the response reports `inferenceSource: "in_cloud"`.
>
> PillCheck's [on-device guard](src/guards/onDeviceGuard.ts) therefore:
> 1. **checks before every on-device step** (`assertNanoReady`, `assertLocalSpeechReady`), so private text never reaches the SDK unless Gemini Nano is present and ready;
> 2. **checks after every on-device step** (`assertRanOnDevice(response.inferenceSource)`), so any SDK regression fails loudly instead of leaking quietly;
> 3. **treats "can't tell" as "no"**: a missing API, a thrown error or an unknown state all mean refusal.
>
> When it refuses, the big button still works: it **says** the refusal out loud with a local voice, so Meera hears why nothing happened.

### Testing the refusal (no on-device model)

| How | What you should see |
|---|---|
| `http://localhost:5173/?simulate=no-nano` | Refusal; helper details say "Turned off on purpose for this demo" |
| `?simulate=no-speech` or `?simulate=no-nano,no-speech` | Same, for speech or both |
| A Chrome profile with the Gemini Nano flag **off**, or any non-Chrome browser | Refusal: "doesn't offer Gemini Nano" |
| Press **Check my medicine** on the refusal screen | It speaks: "I can't check safely on this device…" |

`?simulate` works in production builds on purpose: it can only *remove* capabilities, never add or bypass one.

### Step 1: how "on-device listening" is enforced

[`step1-transcribe.ts`](src/pipeline/step1-transcribe.ts) refuses unless **all** of these hold:
1. the on-device guard reports the US-English speech pack as `available`;
2. the recogniser exposes `processLocally`, and reading it back after setting it to `true` returns `true`;
3. no `network` error occurs. On-device recognition needs no network, so a network error means the browser tried a server, and PillCheck refuses instead of retrying.

The transcript lives only in memory: it isn't logged, stored or sent.

### Step 2: the privacy airlock (Gemini Nano, `ONLY_ON_DEVICE`)

[`step2-extract.ts`](src/pipeline/step2-extract.ts) turns the full transcript (which might include a name, a birthday or a dose) into a bare list such as `["advil", "warfarin"]`:

- `getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams: { createOptions, promptOptions: { responseConstraint } } })`
- **Guard before, check after:** `assertNanoReady()` runs before the transcript is handed to the SDK, and `assertRanOnDevice(response.inferenceSource)` runs on the result.
- **Instructions go in `createOptions.initialPrompts` (role `system`), not `systemInstruction`.** Verified in the SDK source: the on-device path only forwards `createOptions` and the request contents to Chrome's Prompt API. A `systemInstruction` would silently never reach Nano.
- **Structured output on-device:** a JSON Schema is passed as `responseConstraint`, so Nano must answer `{"medicines": [...]}` (max 5 names, 40 characters each). A first-pass clean-up drops anything with digits, `@`, `/` and the like. The full leak guard comes on Day 5.

**Try it without speaking (dev builds only):** in the DevTools console at localhost, run

```js
await __pillcheck.extract("This is Meera, born March 3rd. Can I take two Advil with my warfarin?")
// → { medicines: ["advil", "warfarin"], where: "on-device", inferenceSource: "on_device" }
```

**Tests run the browser build of Firebase AI Logic.** Under Node, `firebase/ai` resolves to a build with *no* on-device adapter, where everything goes to the cloud. [`vitest.config.ts`](vitest.config.ts) aliases it to the browser build, and a control test proves that (Nano present → zero network requests).

### The leak guard: what is allowed to leave

[`leakGuard.ts`](src/guards/leakGuard.ts) runs on everything bound for the cloud. **Any finding is a hard block**: nothing is sent, the screen shows why, and PillCheck says so out loud.

| Check | What it catches |
|---|---|
| **Shape** | Anything but `{ medicines: string[], cabinet?: string[] }`, e.g. an extra `patientName` field |
| **Structural PII** (runs on every entry) | emails, ID numbers, dates, phone numbers, addresses, any digits (doses, ages, times) |
| **Allowlist** | every entry must be a known medicine in the [openFDA lexicon](src/data/drug-lexicon.json) (2,000+ ingredients, thousands of brands, public domain) |
| **Word PII** (only on unknown entries) | titles (Mrs, Dr), personal phrases ("my name is", "born"); 2–3 unknown words are flagged as a *possible name* |
| **Rebuild** | the payload is **rebuilt from canonical ingredient names in the lexicon**. "Advil" becomes `ibuprofen`, so Meera's own words are never what's sent |

**The lexicon's own safety rules** ([`scripts/build-lexicon.ts`](scripts/build-lexicon.ts), `npm run build:lexicon`):
- only brands taken by mouth;
- a brand is kept **only if every product under that name has the same ingredients**. Store brands like "Equate" or "CVS" sell dozens of different drugs under one name, and mapping them would check the wrong drug;
- no entry contains a digit or symbol, enforced by a test.

**Demo the block:** open `http://localhost:5173/?simulate=inject-pii`, press the button and say "Can I take ibuprofen?". A fictional name and birthday are added after Nano (simulating a model that leaked them), and you get **🛑 Stopped before sending**: *"What looks like a person's name: 'Meera Sharma'"*, *"A date: '12/03/1951'"*, *Nothing left this device*.

### Step 3: the interaction check (cloud Gemini, `ONLY_IN_CLOUD`)

[`step3-check.ts`](src/pipeline/step3-check.ts) is the only step that sends anything off the device:

1. **Leak guard again, inside Step 3** (`assertSafeToSend`), immediately before the network, so no caller can skip it.
2. **Grounding in official FDA labels.** [`labelGrounding.ts`](src/pipeline/labelGrounding.ts) fetches the *drug interactions*, *boxed warning*, *ask a doctor* and *use in older adults* sections from the public openFDA label API, for the cleaned ingredient names only.
3. **Gemini, `InferenceMode.ONLY_IN_CLOUD`**, behind App Check with limited-use tokens, returns JSON (`responseSchema`): `verdict` (ok / caution / avoid / unsure), `spoken` (1–3 sentences, under 50 words, written to be heard), optional `waitHours`, and `interactions`.
4. **Validation before Meera hears anything:** the verdict must be one of the four; at most 3 sentences; interactions may only name medicines that were actually sent; `waitHours` must be 1–48.
5. **Personalised on-device:** the cloud saw `calcium carbonate`, but Meera said "Tums", so the name she used is put back locally after the answer arrives.

**Why the cloud for this step, and no on-device fallback:** a safety call about drug interactions needs the larger model plus label grounding. If the cloud is unreachable, PillCheck says *"I couldn't check right now… ask your pharmacist"*. It never lets Nano say "that's safe".

**Cloud models, tried in order:** `gemini-3.5-flash-lite`, then `gemini-3.8-flash` (both cloud, same payload). Measured on 14 Nov 2026: flash-lite answered correctly in about 6–12 s, while 3.8-flash was returning *500 "high demand"*. Remote Config takes over this list on Day 9.

**Live results** (real Gemini, real FDA labels):

| Asked | Verdict | Spoken answer |
|---|---|---|
| Advil, while on warfarin | **avoid** | "Please don't take ibuprofen while you are on warfarin. Using them together greatly raises your risk of serious bleeding. Check with your doctor or pharmacist first." |
| Synthroid + Tums | **caution**, waitHours 4 | "…you need to wait at least four hours between them so your body can absorb your thyroid medicine properly." |
| Tylenol, while on warfarin + lisinopril | **caution** | "…taking acetaminophen while you take warfarin requires caution because it can affect your bleeding risk…" |

**Try Step 3 without speaking (dev builds):** `await __pillcheck.check(["advil"], ["warfarin"])` in the console at localhost.

### Step 5: an audit log that can't hold private data

Every check writes one entry to `users/{anonymous uid}/audit/{id}` in Cloud Firestore ([`step5-audit.ts`](src/pipeline/step5-audit.ts)), recording **where each step actually ran** and **exactly what left the device**:

```json
{
  "outcome": "answered",
  "route": { "transcribe": "on-device", "extract": "on-device", "check": "cloud", "speak": "on-device" },
  "inferenceSource": { "extract": "on_device", "check": "in_cloud" },
  "leakGuard": { "result": "passed", "findings": [] },
  "sent": { "medicines": ["ibuprofen"], "cabinet": ["warfarin"] },
  "verdict": "avoid", "model": "gemini-3.5-flash-lite", "grounded": ["ibuprofen", "warfarin"],
  "demo": { "injectedPii": false, "simulate": [] },
  "at": "<server time>", "schemaVersion": 1, "appVersion": "0.1.0"
}
```

It's private by construction, with three layers:
1. **Builder:** entries are assembled only from fixed status words, finding *types* and the canonical ingredient names that were actually sent. Never the transcript, never "Advil", never the text the guard caught.
2. **Client check:** `assertAuditSafe` rejects any string outside that closed vocabulary.
3. **[Security rules](firestore.rules):** own UID only, **append-only** (no edits or deletes), exact field list, enum values, server timestamp. They also check consistency: a *blocked* entry must show nothing sent, and `extract` can only ever be `on_device`, so the log can't even record Step 2 in the cloud. Rules tests: [`tests/rules/`](tests/rules/firestore.rules.test.ts), **12 cases, all passing on the Firestore emulator**. Run with `npm run test:rules`. It needs Java 21+: `brew install openjdk@21`, then `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`. The emulator uses port 8181.

Audit writes are fire-and-forget: a slow or offline Firestore never delays the spoken answer.

### My medicines: kept on the device

Meera (or a family member, once) presses **＋ Add a medicine** and says *"I take Coumadin and Lipitor"*. From then on, every check includes them as `already_taking`.

- **Stored only in this browser** ([`cabinet.ts`](src/cabinet/cabinet.ts), `localStorage`), never in Firestore. A list of someone's medicines is health data, and the anonymous account belongs to this browser anyway, so the cloud would add risk without adding sync.
- **Added using Steps 1–2 only** ([`addByVoice.ts`](src/cabinet/addByVoice.ts)): on-device speech → Gemini Nano → lexicon. **No network request at all**, and a test asserts `fetch` is never called.
- **Only recognised medicines can be stored**, and stored data is re-checked against the lexicon on every load. So the list can't hold a name or a note, even if someone edits storage by hand.
- **Leaves the device only inside a check**, as canonical ingredient names after the leak guard. Gemini sees `warfarin`, and Meera still hears *"Please don't take Advil with your **Coumadin**…"* (live result), because her names are put back on-device.
- **Removing takes two taps** ("Remove" → "Tap again to remove"), so one stray tap can't silently take warfarin off the list every check depends on.

### The pipeline in one file

[`orchestrator.ts`](src/pipeline/orchestrator.ts) runs Steps 1–5 for each press of the button, with every step injected so [`tests/orchestrator.test.ts`](tests/orchestrator.test.ts) can drive the whole flow with fakes. That includes the inject-PII demo (blocked, no cloud call, audit holds finding types only) and each refusal path.

**Try it:** press **Check my medicine** and say "Can I take ibuprofen?". The words appear as you speak, then "You asked: …", the medicine names, and two badges: 🔒 *Heard on this device* and 🔒 *Understood on this device*. With DevTools → Network open (filter "All"), **no request** is made while you speak. Press the button again ("I'm done talking") to stop early. Stay silent and it says "I didn't hear anything…".

## Architecture

```mermaid
flowchart LR
  subgraph Device["🔒 Senior's device (Chrome)"]
    Mic[Big button + mic] --> STT[Step 1<br/>On-device speech]
    STT -->|transcript| Nano[Step 2<br/>Gemini Nano<br/>ONLY_ON_DEVICE]
    Nano -->|drug names| Guard{Leak guard}
    Guard -->|blocked| Stop[Visible error<br/>no cloud call]
    TTS[Step 4<br/>On-device voice]
  end
  subgraph Cloud["☁️ Firebase"]
    Gemini[Step 3<br/>Cloud Gemini<br/>ONLY_IN_CLOUD]
    FS[(Step 5<br/>Firestore audit log)]
    AC[App Check]
  end
  Guard -->|"['warfarin','ibuprofen']"| AC --> Gemini
  Gemini -->|1–3 sentences| TTS
  Gemini -.-> FS
```

## Before / after

| | Before PillCheck | With PillCheck |
|---|---|---|
| When unsure about a pill | Calls family, waits, or skips the dose | Presses one button and asks out loud |
| Time to an answer | Minutes to hours, or never | Seconds |
| Skill needed | Reading tiny leaflet print, typing | Speaking |
| Privacy | n/a | Voice and identity never leave the device; the cloud sees drug names only |
| If the device can't run AI locally | n/a | Clear refusal, never a silent upload |

## Setup

**Prerequisites:** Node 22+, Chrome desktop 139+ on a machine with a GPU (>4 GB VRAM) or 16 GB RAM, ≥22 GB free disk, a Firebase project.

1. **Chrome:** open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → *Enabled* → restart. In DevTools, `await LanguageModel.availability()` should return `available`, `downloadable` or `downloading`.
2. **Firebase console:**
   1. Add a **Web app** and copy its config.
   2. **AI Logic** → Get started → Gemini Developer API.
   3. **Authentication** → Sign-in method → enable **Anonymous**.
   4. **Firestore Database** → Create database → production mode. Then deploy the rules:
      ```bash
      cp .firebaserc.example .firebaserc   # put your project ID in it
      npx firebase login
      npm run deploy:rules
      ```
   5. **App Check** → register the web app with **reCAPTCHA Enterprise** (score-based key, your Hosting domains, *not* localhost).
3. **Local config:**
   ```bash
   cp .env.example .env.local   # then fill in the values
   npm install
   npm run dev
   ```
4. **App Check debug token:** open http://localhost:5173, copy the debug token printed in the browser console, and add it under App Check → Apps → ⋮ → *Manage debug tokens*. Reload.

   *Tip:* set `VITE_APPCHECK_DEBUG_TOKEN` in `.env.local` to a fixed UUID (`uuidgen`) and register that value once; then every local browser shares it.
5. **One-time on-device setup:** if speech recognition or Gemini Nano isn't downloaded yet, PillCheck shows **Set up PillCheck**. Click it once; it installs the US-English speech pack and downloads Gemini Nano, with progress.
6. **Tests:** `npm test` (unit tests for the guard plus the SDK fall-through evidence test).

You should see the **System check** panel with Firebase ✓, App Check ✓, Anonymous sign-in ✓ and the on-device capability rows.

## Demo script (draft, finalised on Day 15)

1. Meera presses **Check my medicine**: "Can I take ibuprofen?" → spoken answer naming her blood thinner. The provenance strip shows *heard on-device → understood on-device → checked in cloud → spoken on-device*.
2. **Leak guard:** inject "for Meera Sharma, born 3 Dec 1951" → the cloud call is blocked, with a visible error and an audit entry.
3. **No on-device model:** a Chrome profile without the flag → "I can't check safely on this device." DevTools Network shows zero requests to the model.
4. **Offline replay:** Wi-Fi off → the last answer replays with the local voice.
5. **Privacy receipt:** the Firestore audit log shows drug names and inference sources only.

## Repo map

```
src/firebase/     App, App Check, Auth, AI Logic instance (Firestore, Remote Config to come)
src/guards/       onDeviceGuard.ts (fail-closed) · leakGuard.ts (what may leave the device)
src/data/         drug-lexicon.json (openFDA, generated) · aliases.ts (curated) · lexicon.ts
scripts/          build-lexicon.ts
src/pipeline/     orchestrator.ts (Steps 1–5) · policy.ts (routing policy) · step1–step5 · labelGrounding · messages
firestore.rules   per-user, append-only, schema-checked audit log
src/cabinet/      cabinet.ts (on-device medicine list) · addByVoice.ts · useCabinet.ts
src/ui/           RefusalScreen, SetupCard, ListeningPanel, GuardResult, AnswerCard, CabinetCard, SystemCheck
tests/            onDeviceGuard · step1–3 · step5-audit · orchestrator · leakGuard · lexicon · sdkFallthrough (evidence + control) · rules/ (emulator)
docs/             plan, architecture, evidence, demo script
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
PillCheck is not medical advice and is not a substitute for a pharmacist or doctor.
