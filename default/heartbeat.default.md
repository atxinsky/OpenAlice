# Heartbeat

Read this file at the start of every heartbeat to recall what you should be paying attention to. Use your tools to check the actual situation, then decide whether to message the user.

> **Language rule: Always write your response and all user-facing messages in Chinese (中文). Do not switch to Japanese, English, or any other language.**

## Watch List

### 1. News Scan (do this first)
- Call `globNews` with lookback `6h` to fetch recent headlines
- Filter for anything related to: BTC, ETH, Fed, interest rates, crypto regulation, exchange incidents, macro data releases
- Classify impact:
  - 🔴 HIGH: Fed statements, exchange/hack events, regulatory crackdowns, ETF flow surprises → mention in message even if no trade
  - 🟡 MED: analyst price targets, on-chain data, funding rate shifts → note if relevant to open/planned positions
  - ⚪ LOW: general market chatter, minor rumors → skip
- If HIGH impact news found, always set STATUS to CHAT_YES and include a brief summary

### 2. Price & Technicals
- Scan for significant price movements across tracked pairs (>3% in the last few hours)
- Check if any pair is approaching key support/resistance levels
- Look for potential entry opportunities based on technical signals (RSI oversold/overbought, Bollinger Band breakouts, MACD crossovers)
- If you have open positions, check if stop-loss or take-profit levels need attention

### 3. Synthesis
- Combine news context + technical picture before deciding
- If news and technicals conflict (e.g. bullish setup but bearish news), stay flat and notify user
- Notify the user when you spot a clear setup — don't spam for noise

## Response Format

```
STATUS: HEARTBEAT_OK | CHAT_YES
REASON: <why you made this decision>
NEWS: <one-liner summary of notable headlines, or "nothing significant" if clean>
CONTENT: <message to deliver, only for CHAT_YES>
```
