# Heartbeat — Protocol v2.0

Read this file at the start of every heartbeat. Follow ALL steps in order. Use your tools to check the actual situation, then decide whether to message the user.

> **Language rule: Always write your response and all user-facing messages in Chinese (中文). Do not switch to Japanese, English, or any other language.**

---

## PRE-CHECK: Quote API Circuit Breaker (Run First)

Before anything else, attempt `getQuote` on BTC and ETH using the CORRECT aliceId format:
- ✅ CORRECT: `aliceId: "binance-demo|BTC/USDT:USDT"` (source prefix required)
- ✅ CORRECT: `aliceId: "binance-demo|ETH/USDT:USDT"`
- ❌ WRONG: `aliceId: "BTC/USDT:USDT"` (without prefix → "No account could quote" error)

- If API is DOWN for **1–3 consecutive heartbeats**: Mark prices as stale. Note in report. Strategy updates still allowed.
- If API is DOWN for **4–10 consecutive heartbeats**: Mark `CIRCUIT_BREAKER: LEVEL 1`. Freeze all strategy changes. Only price-independent events (regulatory, hack, black swan) may trigger CHAT_YES.
- If API is DOWN for **10+ consecutive heartbeats**: Mark `CIRCUIT_BREAKER: LEVEL 2`. Freeze all strategy changes. Notify user with: "Quote API has been down for 5+ hours. Manual price check required."

All price references under circuit breaker must be labeled: `[STALE — from news, not live feed]`

---

## Step 1: Information Increment Declaration

Before scanning news, declare the information budget for this heartbeat:

```
INFORMATION INCREMENT:
- New articles (not seen before): [N]
- Price breakthroughs: [N]
- Strategy changes: [N]
- Repeated topics from prior heartbeats: [list them,衰减系数 applied]
```

If new articles = 0, price breakthroughs = 0, strategy changes = 0 → STATUS must be HEARTBEAT_OK unless black swan event.

---

## Step 2: News Scan

Call `globNews` with lookback `2h` first. If fewer than 3 new articles, extend to `6h`.

### Signal Classification Rules (v2.0)

**Price-Confirmation Required for HIGH:**
- News alone (no price confirmation) → MAX rating: MED. No strategy change allowed.
- Price moves >2% in signal direction within 4H after news → upgrade to HIGH, strategy review allowed.
- Price moves >5% in signal direction → upgrade to CRITICAL, strategy change required.
- Exception: True black swan events (exchange hack, regulatory ban, war declaration) may be rated HIGH without price confirmation.

**Information Decay:**
- First mention of a topic: weight 1.0, full analysis
- Second mention: weight 0.5, brief update only
- Third mention and beyond: weight 0.1, one line in summary table only, NO expanded analysis

**Classification:**
- HIGH (with price confirmation OR black swan): Fed statements, exchange/hack events, regulatory crackdowns, ETF flow surprises
- MED: analyst price targets, on-chain data, funding rate shifts, scenario analysis articles
- LOW: general market chatter, minor rumors → list in one line only, do not expand

---

## Step 3: Price & Technicals

- Check significant price movements (>3% in recent hours)
- Check if any pair approaches key support/resistance from Strategy Commits
- Check Strategy Commit status (see frontal-lobe.md for active SCs)
- If SC entry zone is reached: verify confirmation signals before flagging entry

---

## Step 4: Synthesis

- Combine news context + technical picture
- If news and technicals conflict, stay flat and notify user
- Apply signal decay: do not re-analyze topics already covered in recent heartbeats

---

## Step 5: Counter-Thesis (Mandatory for CHAT_YES)

If this heartbeat reaches CHAT_YES status, you MUST include a Counter-Thesis block.

Rules:
- If current bias is **bearish**: find the single strongest bull argument available right now. State specifically what price action or event would make you switch to bullish. If you cannot find any credible bull argument, explicitly state "No credible counter-thesis found — this itself is a signal to double-check for confirmation bias."
- If current bias is **bullish**: find the single strongest bear argument. Same format.
- Do NOT pad with length. Quality over quantity. One strong argument beats five weak ones.
- Format:

```
COUNTER-THESIS:
[Strongest opposing argument]
Invalidation condition: [specific price level or event that would flip the thesis]
Why I still maintain current bias despite this: [one clear reason]
```

---

## Step 6: Scenario Analysis (replaces fake probability tables)

If market direction is ambiguous, list 2–3 scenarios with **qualitative weights** only:

- Primary scenario (most likely based on current evidence)
- Secondary scenario (meaningful alternative, cannot be dismissed)
- Tail risk (low probability but high impact)

Do NOT assign precise percentages. Use: Primary / Secondary / Tail Risk labels only.

---

## Step 7: Strategy Commit Check

Check all active Strategy Commits in frontal-lobe.md:

- Has price reached any entry zone? → Check confirmation signals
- Has any invalidation condition been triggered? → If yes, close that SC and record why it failed
- Has entry target shifted more than 5% from original? → If yes, this SC must be formally closed and a new one opened with explicit rationale

Do NOT silently move entry targets. All changes require closing the old SC first.

---

## Response Format

```
CIRCUIT_BREAKER: [NONE | LEVEL 1 | LEVEL 2]
STATUS: HEARTBEAT_OK | CHAT_YES
REASON: <why you made this decision>
NEWS: <one-liner: new articles only, with decay status for repeated topics>
CONTENT: <message to deliver, only for CHAT_YES — must include Counter-Thesis block>
```

### CHAT_YES Trigger Conditions (v2.0 — stricter threshold)

Trigger CHAT_YES only if at least ONE of the following:
1. A genuinely new HIGH-rated signal (price-confirmed, or true black swan)
2. A Strategy Commit entry zone reached
3. A Strategy Commit invalidation condition triggered
4. Circuit Breaker status changes
5. A new MED signal that directly contradicts the current thesis

Do NOT trigger CHAT_YES for:
- Repeated topics (weight 0.1)
- Hypothetical/scenario analysis articles without price confirmation
- General market chatter repackaged as analysis
- "Confirming" existing bearish/bullish thesis with same evidence seen before

Target CHAT_YES rate: 30–40% of heartbeats. If exceeding this, review signal classification.
