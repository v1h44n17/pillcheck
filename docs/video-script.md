# PillCheck: demo video (Day 16)

**Limit:** 3:00, public on YouTube, English, with English subtitles ([`video-subtitles.en.srt`](video-subtitles.en.srt)).
**Narration length:** 2:22 at a normal pace (150 words a minute), which leaves ~35 s for pauses and clicks. If your cut runs over 2:55, trim scene 3's last line first, then scene 6's last line.

The four judging criteria and where the video answers each:

| Criterion | Scene |
|---|---|
| Technological implementation (hybrid inference) | 3, 4, 5 |
| Design (complete product) | 2, 6 |
| Potential impact | 1, 6 |
| Quality of the idea | 1, 3 ("the cloud only sees drug names") |

## Before you record

**Machine**
- [ ] Record on the Mac where Gemini Nano works (Chrome 156). Open **For family & helpers → System check**: speech and Gemini Nano must say **ready**.
- [ ] Use a fresh Chrome profile, so the privacy log in scene 6 shows only this take's checks. It also gets a new anonymous account. Confirm the System check is still all green in that profile.
- [ ] Turn on Do Not Disturb, hide the Dock and bookmarks bar, and close other tabs. Use window size 1440×900 or larger at 100% zoom.
- [ ] Use headphones while recording, so the microphone doesn't hear PillCheck's own voice. Capture **system audio**, because PillCheck's spoken answers are part of the demo.

**App state** (on https://pillcheck-by-v1h44n.web.app/?demo)
- [ ] **My medicines → ＋ Add a medicine** → *"I take Coumadin and Lipitor."* Both appear.
- [ ] Do one practice check (*"Can I take Advil?"*), then reload so the screen is idle. Practice checks will show in the privacy log, so either keep them or make a new profile.
- [ ] All Demo controls are **OFF**.

**Recording tips**
- Record the screen and the app audio in one take, scene by scene. Record the voice-over separately and lay it on top, because it's easier to cut than talking live.
- Say *"Can I take Advil?"* slowly and clearly, then press the button again (*I'm done talking*) to skip the silence wait.
- If an answer is worded slightly differently from the script, keep the real one and edit that subtitle line. Never re-voice the app.

## Shooting script


### 1. Hook and problem (starts ~00:01)

**On screen:** Title card: **PillCheck**, *one button, a calm answer*. Then the app idle at `/?demo`, big button centred. Optional: a bottle of pills on the desk.

| At | Who | Line | ~s |
|---|---|---|---|
| 00:01 | You (voice-over) | Meera is seventy-four and takes five medicines, including warfarin, a blood thinner. Her knee hurts. Can she take Advil? | 8 |
| 00:09 | You (voice-over) | One in six older Americans is at risk of a major drug interaction. | 5.6 |
| 00:15 | You (voice-over) | An AI could answer in seconds, but it would hear her voice, her name and her health. PillCheck is built so the cloud only ever sees drug names. | 11.6 |

### 2. The answer (starts ~00:28)

**On screen:** Press **Check my medicine**. Show the words appearing, then the answer card with **avoid**. Let PillCheck's voice play in full.

| At | Who | Line | ~s |
|---|---|---|---|
| 00:28 | Meera / you, into the mic | Can I take Advil? | 2 |
| 00:33 | **PillCheck** (app audio) | Please don't take Advil with your Coumadin. Using them together greatly raises your risk of serious bleeding. Check with your doctor or pharmacist first. | 9.5 |
| 00:43 | You (voice-over) | It said Coumadin: the name on her own list, which lives only in this browser. | 6.4 |

### 3. How the hybrid split works (starts ~00:50)

**On screen:** Zoom in on the **provenance strip** (Heard 🔒 · Understood 🔒 · Privacy check 🔒 · Checked ☁️ · Spoken 🔒 · Logged ☁️). Then open **Why, and what was sent**, showing `ibuprofen`, `warfarin`, `atorvastatin`. Optional 3 s cut to the README routing table.

| At | Who | Line | ~s |
|---|---|---|---|
| 00:50 | You (voice-over) | Each step is pinned to one place. Speech recognition runs on this computer. Gemini Nano, through Firebase AI Logic in ONLY ON DEVICE mode, pulls out the drug names. | 12 |
| 01:02 | You (voice-over) | A leak guard lets only known ingredient names through. Then cloud Gemini, in ONLY IN CLOUD mode, checks the interaction against F.D.A. labels, and a local voice speaks the answer. | 12.4 |
| 01:15 | You (voice-over) | The strip shows where every step ran. Everything that left the device: three drug names. | 6.4 |

### 4. Leak guard (starts ~01:22)

**On screen:** Demo controls → **Add a fake name and birthday: ON**. Press the button and ask *"Can I take Advil?"* again. Show 🛑 **Stopped before sending** with *Meera Sharma* and *12/03/1951*, and the strip: **Checked: Nothing sent**.

| At | Who | Line | ~s |
|---|---|---|---|
| 01:22 | You (voice-over) | Now I'll simulate a model leaking a name and birthday. | 4.4 |
| 01:30 | **PillCheck** (app audio) | I stopped before checking, because something personal was about to be sent. Nothing left this device. | 6 |

### 5. Fails closed (starts ~01:36)

**On screen:** Fake name **OFF** → **Pretend there's no on-device AI: ON** → press the button. Show the refusal screen while it speaks.

| At | Who | Line | ~s |
|---|---|---|---|
| 01:36 | You (voice-over) | I found that without Chrome's on-device model, the SDK quietly sends ON DEVICE requests to the cloud. So PillCheck checks every on-device step, and refuses instead. | 10.8 |
| 01:51 | **PillCheck** (app audio) | I can't check safely on this device. I won't send your question anywhere. If you're unsure about a medicine, please call your pharmacist. | 8 |

### 6. Trust (starts ~01:59)

**On screen:** Switch it OFF. **For family & helpers → Show my privacy log**: the plain-language list. Then 2 s on `docs/eval-results.md` (**30 / 30**).

| At | Who | Line | ~s |
|---|---|---|---|
| 01:59 | You (voice-over) | Every check is logged in Firestore with no personal data, and App Check is enforced. Her family can read it back: only medicine names ever left this computer. | 11.6 |
| 02:11 | You (voice-over) | On thirty test pairs: no missed dangers, no false alarms. | 4.4 |

### 7. Close (starts ~02:16)

**On screen:** Back to the idle app. End card: live URL `pillcheck-by-v1h44n.web.app`, *Built with Firebase AI Logic hybrid inference*, *Not medical advice*.

| At | Who | Line | ~s |
|---|---|---|---|
| 02:16 | You (voice-over) | PillCheck. One button, a calm answer, and her voice stays home. | 4.8 |

**Ends at about 02:22.**

## After recording

1. **Subtitles:** in YouTube Studio → Subtitles → English → *Upload file* → **With timing**, and pick `docs/video-subtitles.en.srt`. Its times assume the pacing above. If your cut differs, choose **Without timing** and upload [`video-transcript.en.txt`](video-transcript.en.txt) instead: YouTube's **auto-sync** times it to your audio.
2. Set the title to *PillCheck: private, voice-first medication checker (Firebase AI Logic hybrid)*. Set visibility to **Public**, and check it plays while logged out.
3. Paste the link into `docs/devpost.md` (the video `TODO`) and into the README.

## Claims in the narration, and where each is backed

| Line | Source |
|---|---|
| "One in six older Americans is at risk of a major drug interaction" | Qato et al., *JAMA Internal Medicine* 2016: 15.1% (README → Why) |
| "the SDK quietly sends ON DEVICE requests to the cloud" | `tests/sdkFallthrough.test.ts`, run against the real SDK (README → Fail-closed) |
| "App Check is enforced" | Live 401s for missing or forged tokens (README → Security in production) |
| "thirty test pairs: no missed dangers, no false alarms" | `docs/eval-results.md`: 0/20 missed, 0/10 over-warnings |
