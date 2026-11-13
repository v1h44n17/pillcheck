# PillCheck: Build Plan (v0, awaiting confirmation)

Deadline: **1 Dec 2026, 03:30 IST** (= 30 Nov 2026, 22:00 UTC). Internal submit target: **30 Nov, 18:00 IST**.
Today: 13 Nov 2026 (Day 0, planning only).

---

## 1. API verification notes (checked 13 Nov 2026)

| Claim | Status | Source |
|---|---|---|
| Package `firebase`, import from `firebase/ai`: `getAI`, `getGenerativeModel`, `GoogleAIBackend`, `InferenceMode` | ✅ Confirmed | firebase.google.com/docs/ai-logic/hybrid/web/get-started |
| Modes: `InferenceMode.PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD` | ✅ Confirmed | same |
| Config shape: `getGenerativeModel(ai, { mode, onDeviceParams: { createOptions: { expectedInputs, expectedOutputs, initialPrompts } }, inCloudParams: { model, generationConfig } })` | ✅ Confirmed | firebase.google.com/docs/ai-logic/hybrid/web/configuration-options |
| `result.response.inferenceSource` → `"ON_DEVICE"` / `"IN_CLOUD"` (SDK ≥ 12.5.0) | ✅ Confirmed | same |
| `model.initializeDeviceModel(progressCb)`, must be called on a user gesture, before the first prompt | ✅ Confirmed | get-started |
| Default cloud model `gemini-3.5-flash-lite` (SDK ≥ 13.0.0) | ✅ Confirmed | configuration-options |
| Latest npm `firebase` = **13.3.0** (we pin this) | ✅ Checked via `npm view` | npm |
| Requirements: Chrome desktop ≥ 139, flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, check with `await LanguageModel.availability()` | ✅ Confirmed | get-started |
| On-device: text and JPEG/PNG input only; single-turn; structured output (JSON/enum) supported; 9216-token limit | ✅ Confirmed | hybrid-on-device-inference |
| **On-device AUDIO input via Firebase hybrid: NOT supported.** `ONLY_ON_DEVICE` + audio throws | ⚠️ **Affects Step 1** | hybrid-on-device-inference |
| Raw Chrome Prompt API (`LanguageModel.create({ expectedInputs:[{type:"audio"}] })`) accepts audio but **needs a GPU**; the doc table lists Web support at Chrome 148; I couldn't confirm the stable vs origin-trial status | ⚠️ Unverified | developer.chrome.com/docs/ai/prompt-api |
| Web Speech on-device: `SpeechRecognition.available({langs, processLocally:true})`, `SpeechRecognition.install(...)`, `recognition.processLocally = true`. **Default Chrome Web Speech sends audio to Google servers** | ✅ Confirmed (MDN); exact Chrome version still to check on your machine | MDN SpeechRecognition/processLocally |
| App Check for AI Logic: `getAI(app, { backend, useLimitedUseAppCheckTokens: true })` for replay protection; Web provider = reCAPTCHA Enterprise (score-based key); localhost uses `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` | ✅ Confirmed | firebase.google.com/docs/ai-logic/app-check |
| Hardware: macOS 13+, ≥22 GB free on the Chrome profile volume, GPU >4 GB VRAM (or 16 GB RAM with 4+ cores, CPU only) | ✅ Confirmed | developer.chrome.com/docs/ai/prompt-api |
| Inference-source enum | ✅ `InferenceSource.ON_DEVICE = "on_device"`, `IN_CLOUD = "in_cloud"` (lowercase values; the docs show the keys) | `@firebase/ai@3.1.0` `ai-public.d.ts` |
| On-device structured output | ✅ `onDeviceParams.promptOptions.responseConstraint` (JSON Schema object) | same |
| **ONLY_ON_DEVICE silently uses the cloud when `LanguageModel` is missing** | ✅ Confirmed in source (`chromeAdapterFactory` + `callCloudOrDevice`) and proven by `tests/sdkFallthrough.test.ts` | `@firebase/ai@3.1.0` `index.esm.js` |

### Consequence for the architecture (needs your sign-off)
In the brief, Step 1 is "ONLY_ON_DEVICE (Gemini Nano)" transcription. The Firebase hybrid SDK **cannot** do on-device audio. Proposed approach:

- **Step 1 = Chrome on-device speech recognition** (`processLocally = true`, the SODA engine). It's on-device but **not Gemini Nano** and **not Firebase AI Logic**. Gate it with a hard check: if `available({processLocally:true})` isn't `"available"`, we refuse. We never fall back to server STT.
- **Step 2 = Firebase AI Logic `ONLY_ON_DEVICE`** (Gemini Nano, text in, JSON out). This is the hybrid on-device call judges will look for.
- **Step 3 = Firebase AI Logic `ONLY_IN_CLOUD`**.
- *Stretch:* Step 1 via the raw Prompt API with audio input (Nano). Only if it works on your hardware by Day 3; otherwise cut.

---

## 2. 17-day milestones (each ends with a runnable checkpoint)

| Day | Date | Milestone | Checkpoint you can run |
|---|---|---|---|
| 0 | Thu 13 Nov | Plan, API verification | This doc |
| 1 | Fri 14 | Scaffold: Vite + React + TS, Firebase init, anonymous Auth, App Check (debug), LICENSE, README skeleton, `.env.example` | `npm run dev` shows the anon UID and "App Check token ✓" |
| 2 | Sat 15 | **On-device guard**: capability probe (Nano + local STT), app-level throw if adapter missing, "I can't check safely on this device" screen, `?simulate=no-nano` switch | Refusal screen shows in a non-flagged Chrome profile *and* via the query param |
| 3 | Sun 16 | **Step 1**: big button, on-device speech capture → transcript (no network) | Speak; the transcript appears; DevTools Network shows 0 requests |
| 4 | Mon 17 | **Step 2**: Nano extraction (`ONLY_ON_DEVICE`, JSON), post-check `inferenceSource === "ON_DEVICE"` else throw | "Can I take ibuprofen?" → `["ibuprofen"]`, badge "on-device" |
| 5 | Tue 18 | **Drug lexicon + Leak guard** (allowlist plus PII detectors), Vitest suite | `npm test` green; guard blocks "ibuprofen for Meera Sharma 12/03/1951" |
| 6 | Wed 19 | **Step 3**: cloud interaction check (`ONLY_IN_CLOUD`), structured output `{verdict, spoken, waitHours}`, grounding per Q1 | Typed debug input → 1–3 sentence answer, badge "cloud" |
| 7 | Thu 20 | **Step 4 TTS + Step 5 Firestore audit + rules** → **end-to-end thin slice** 🎯 | Full voice round trip; audit doc in Firestore; rules tests pass in the emulator |
| 8 | Fri 21 | Medicine cabinet (the user's own med list), voice-add, stored per UID | "Add warfarin" → saved; checks include the cabinet |
| 9 | Sat 22 | Remote Config (model names, kill switch, guard strictness, timeouts) + per-step provenance strip | Change the model in the console → app uses it after a reload |
| 10 | Sun 23 | Age-friendly design pass: states, type scale, contrast, focus, motion-reduced, a11y audit | Lighthouse a11y ≥ 95; every state reachable |
| 11 | Mon 24 | Demo affordances: hidden "demo panel" (inject PII, simulate no-Nano, go offline then replay answer), "Privacy receipt" audit viewer | All 3 demo beats work in one run |
| 12 | Tue 25 | Deploy to Firebase Hosting; reCAPTCHA Enterprise; **App Check ENFORCED** for AI Logic + Firestore; replay protection | Prod URL works; curl without a token → rejected |
| 13 | Wed 26 | Safety hardening: ~30-case eval set (known interacting pairs), unknown-drug handling, disclaimers, error copy | `npm run eval` report |
| 14 | Thu 27 | Buffer / stretch (Nano audio STT **or** Chrome extension, only if all green). **Feature freeze 23:59** | n/a |
| 15 | Fri 28 | README final, Mermaid diagram, evidence citations verified, Devpost text draft | README review |
| 16 | Sat 29 | Record and edit the ≤3 min demo, English subtitles, YouTube (public) | Video link |
| 17 | Sun 30 | Repo public, secret scan, final prod smoke test, **submit by 18:00 IST** | Devpost confirmation |

**Cut order if behind:** Chrome extension → Nano-audio STT → voice-edit cabinet (fall back to a seeded list) → Remote Config extras (keep model names + kill switch). **Never cut:** App Check enforcement, leak guard, no-Nano refusal, audit log.

---

## 3. Repo structure

```
pillcheck/
├── LICENSE                      # Apache-2.0
├── README.md                    # setup, diagram, routing table, before/after, demo script
├── .env.example                 # VITE_FIREBASE_* + VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
├── .gitignore                   # .env*, .firebase/, debug tokens
├── firebase.json                # hosting + firestore + emulators
├── .firebaserc.example
├── firestore.rules
├── firestore.indexes.json
├── remoteconfig.template.json   # documented defaults (deployable)
├── package.json / tsconfig.json / vite.config.ts / index.html
├── docs/
│   ├── PLAN.md
│   ├── architecture.md          # Mermaid sequence + data-flow diagrams
│   ├── demo-script.md
│   ├── evidence.md              # every statistic with a verified citation
│   └── devpost.md               # submission text
├── scripts/
│   ├── build-lexicon.ts         # generates src/data/drug-lexicon.json
│   └── eval.ts                  # runs the safety eval set against Step 3
├── src/
│   ├── main.tsx / App.tsx
│   ├── firebase/                # app.ts, appCheck.ts, auth.ts, ai.ts, remoteConfig.ts, firestore.ts
│   ├── pipeline/
│   │   ├── policy.ts            # ROUTING POLICY AS CODE (the table judges read)
│   │   ├── orchestrator.ts      # runs steps 1→5, collects provenance
│   │   ├── step1-transcribe.ts  # on-device STT
│   │   ├── step2-extract.ts     # Nano, ONLY_ON_DEVICE
│   │   ├── step3-check.ts       # Gemini, ONLY_IN_CLOUD
│   │   ├── step4-speak.ts       # speechSynthesis (local voices only)
│   │   └── step5-audit.ts       # Firestore audit write
│   ├── guards/
│   │   ├── onDeviceGuard.ts     # capability probe + fail-closed assertions
│   │   ├── leakGuard.ts         # outbound payload scanner (hard block)
│   │   └── piiPatterns.ts
│   ├── data/                    # drug-lexicon.json, lexicon.ts (normalize/alias)
│   ├── cabinet/                 # user's medication list
│   ├── ui/                      # BigButton, AnswerCard, ProvenanceStrip, RefusalScreen, DemoPanel, PrivacyReceipt
│   └── styles/
└── tests/                       # leakGuard, onDeviceGuard, policy, lexicon, firestore.rules
```

---

## 4. Dependencies

Runtime: `firebase@13.3.0` (pinned), `react`, `react-dom`.
Dev: `vite`, `typescript`, `@vitejs/plugin-react`, `vitest`, `@firebase/rules-unit-testing`, `firebase-tools` (CLI), `eslint`.
Browser APIs (no packages): `LanguageModel` (Prompt API, used by the SDK), `SpeechRecognition` with `processLocally`, `speechSynthesis`.
Data: a bundled drug-name lexicon. Source TBD: RxNorm-derived (NLM, needs a free UMLS license for the full set) **or** the openFDA NDC generic/brand names (public domain). Recommendation: openFDA, which has no licence friction.

## 5. Manual console steps (you)

1. Create a Firebase project (or reuse one) and register a **Web app**.
2. **AI Logic** → Get started → pick **Gemini Developer API** (works on the free Spark plan) or Vertex AI (needs Blaze).
3. **Authentication** → enable **Anonymous**.
4. **Firestore** → create the database (pick a region; `asia-south1` if you're in India) → we deploy the rules from the repo.
5. **Remote Config** → we publish from `remoteconfig.template.json` (or create the keys by hand).
6. **App Check** → register the Web app with **reCAPTCHA Enterprise** (create a *score-based* key in Google Cloud; add your Hosting domains, **not** localhost).
7. App Check → **Manage debug tokens** → add the debug token the app prints in the console on localhost.
8. **Day 12:** App Check → APIs → **Enforce** for *Firebase AI Logic* and *Cloud Firestore*. Turn on replay protection for AI Logic.
9. **Hosting** → `firebase init hosting` / deploy.
10. Chrome: enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart, run `await LanguageModel.availability()` in DevTools, and keep ≥22 GB free.

## 6. Config values you'll provide (into `.env.local`, never committed)

`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, and locally only `VITE_APPCHECK_DEBUG=true`. No Gemini API key in the client: AI Logic proxies it.

Remote Config keys: `step2_on_device_enabled`, `step3_cloud_model`, `step3_max_output_tokens`, `leak_guard_mode` (`strict`), `pipeline_kill_switch`, `stt_timeout_ms`.
