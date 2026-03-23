/**
 * Analysis Kit — 统一量化因子计算工具
 *
 * 通过 asset 参数区分资产类别（equity/crypto/currency），
 * 公式语法完全一样：CLOSE('AAPL', '1d')、SMA(...)、RSI(...) 等。
 * 数据按需从 OpenBB API 拉取 OHLCV，不缓存。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EquityClientLike, CryptoClientLike, CurrencyClientLike } from '@/domain/market-data/client/types'
import { IndicatorCalculator } from '@/domain/analysis/indicator/calculator'
import type { IndicatorContext, OhlcvData } from '@/domain/analysis/indicator/types'
import * as Technical from '@/domain/analysis/indicator/functions/technical'
import * as Statistics from '@/domain/analysis/indicator/functions/statistics'

/** 根据 interval 决定拉取的日历天数（约 1 倍冗余） */
function getCalendarDays(interval: string): number {
  const match = interval.match(/^(\d+)([dwhm])$/)
  if (!match) return 365 // fallback: 1 年

  const n = parseInt(match[1])
  const unit = match[2]

  switch (unit) {
    case 'd': return n * 730   // 日线：2 年
    case 'w': return n * 1825  // 周线：5 年
    case 'h': return n * 90    // 小时线：90 天
    case 'm': return n * 30    // 分钟线：30 天
    default:  return 365
  }
}

function buildStartDate(interval: string): string {
  const calendarDays = getCalendarDays(interval)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - calendarDays)
  return startDate.toISOString().slice(0, 10)
}

function buildContext(
  asset: 'equity' | 'crypto' | 'currency',
  equityClient: EquityClientLike,
  cryptoClient: CryptoClientLike,
  currencyClient: CurrencyClientLike,
): IndicatorContext {
  return {
    getHistoricalData: async (symbol, interval) => {
      const start_date = buildStartDate(interval)

      let raw: Array<Record<string, unknown>>
      switch (asset) {
        case 'equity':
          raw = await equityClient.getHistorical({ symbol, start_date, interval })
          break
        case 'crypto':
          raw = await cryptoClient.getHistorical({ symbol, start_date, interval })
          break
        case 'currency':
          raw = await currencyClient.getHistorical({ symbol, start_date, interval })
          break
      }

      // Filter out bars with null OHLC (yfinance returns null for incomplete/missing data)
      const results = raw.filter(
        (d): d is Record<string, unknown> & OhlcvData =>
          d.close != null && d.open != null && d.high != null && d.low != null,
      ) as OhlcvData[]

      results.sort((a, b) => a.date.localeCompare(b.date))
      return results
    },
  }
}

export function createAnalysisTools(
  equityClient: EquityClientLike,
  cryptoClient: CryptoClientLike,
  currencyClient: CurrencyClientLike,
) {
  return {
    calculateIndicator: tool({
      description: `Calculate technical indicators for any asset (equity, crypto, currency) using formula expressions.

Asset classes: "equity" for stocks, "crypto" for cryptocurrencies, "currency" for forex pairs.

Data access: CLOSE('AAPL', '1d'), HIGH, LOW, OPEN, VOLUME — args: symbol, interval (e.g. '1d', '1w', '1h').
Statistics: SMA(data, period), EMA, STDEV, MAX, MIN, SUM, AVERAGE.
Technical: RSI(data, 14), BBANDS(data, 20, 2), MACD(data, 12, 26, 9), ATR(highs, lows, closes, 14).
Array access: CLOSE('AAPL', '1d')[-1] for latest price. Supports +, -, *, / operators.

Examples:
  asset="equity":   SMA(CLOSE('AAPL', '1d'), 50)
  asset="crypto":   RSI(CLOSE('BTCUSD', '1d'), 14)
  asset="currency": CLOSE('EURUSD', '1d')[-1]

Use the corresponding search tool first to resolve the correct symbol.`,
      inputSchema: z.object({
        asset: z.enum(['equity', 'crypto', 'currency']).describe('Asset class'),
        formula: z.string().describe("Formula expression, e.g. SMA(CLOSE('AAPL', '1d'), 50)"),
        precision: z.number().int().min(0).max(10).optional().describe('Decimal places (default: 4)'),
      }),
      execute: async ({ asset, formula, precision }) => {
        const context = buildContext(asset, equityClient, cryptoClient, currencyClient)
        const calculator = new IndicatorCalculator(context)
        return await calculator.calculate(formula, precision)
      },
    }),

    signalSnapshot: tool({
      description: `Compute a full technical indicator snapshot for one symbol in a single call.

Returns all indicators needed for an entry decision checklist:
  price        — latest close price
  atr_14       — ATR(14) in price units; basis for stop-loss sizing (use 2.0–2.5x)
  rsi_14       — RSI(14); overbought >70, oversold <30
  macd_hist    — MACD(12,26,9) histogram; >0 = bullish momentum filter (ETH 4h edge: +0.21%/bar)
  bb           — Bollinger Bands {upper, middle, lower, width_pct}; low width_pct = squeeze
  sma50        — SMA(50); short-term trend anchor
  sma200       — SMA(200); most reliable support (hold rate BTC 50% / ETH 41%)
  near_sma200  — true if price is within 1.5% of SMA200 (high-quality support zone)
  vol_latest   — latest bar volume
  vol_avg20    — 20-bar average volume
  vol_ratio    — vol_latest / vol_avg20; >1.5 = volume-confirmed signal (win-rate 66% vs 47%)
  stop_2atr    — 2 × ATR (recommended minimum stop-loss distance)
  stop_2p5atr  — 2.5 × ATR (wider stop for volatile regimes)

Asset classes: "equity" for stocks, "crypto" for cryptocurrencies, "currency" for forex.
Recommended timeframe: "4h" for crypto entry signals; "1d" for regime / SMA200 checks.`,
      inputSchema: z.object({
        asset: z.enum(['equity', 'crypto', 'currency']).describe('Asset class'),
        symbol: z.string().describe('Symbol, e.g. "ETH/USDT" or "AAPL"'),
        timeframe: z.string().default('4h').describe('Timeframe, e.g. "4h", "1d", "1w"'),
      }),
      execute: async ({ asset, symbol, timeframe }) => {
        const context = buildContext(asset, equityClient, cryptoClient, currencyClient)
        const data = await context.getHistoricalData(symbol, timeframe)

        if (data.length < 30) {
          throw new Error(`Insufficient data: need at least 30 bars, got ${data.length}`)
        }

        const closes = data.map((d) => d.close)
        const highs = data.map((d) => d.high)
        const lows = data.map((d) => d.low)
        const volumes = data.map((d) => d.volume ?? 0)

        const round = (n: number, dp = 4) => parseFloat(n.toFixed(dp))

        const price = closes[closes.length - 1]
        const atr_14 = Technical.ATR(highs, lows, closes, 14)
        const rsi_14 = Technical.RSI(closes, 14)
        const macdResult = Technical.MACD(closes, 12, 26, 9)
        const bbResult = Technical.BBANDS(closes, 20, 2)
        const bb_width_pct = round((bbResult.upper - bbResult.lower) / bbResult.middle * 100)

        let sma50: number | null = null
        let sma200: number | null = null
        try { sma50 = Statistics.SMA(closes, 50) } catch { /* insufficient data */ }
        try { sma200 = Statistics.SMA(closes, 200) } catch { /* insufficient data */ }

        const near_sma200 = sma200 !== null
          ? Math.abs(price - sma200) / sma200 <= 0.015
          : null

        const vol_latest = volumes[volumes.length - 1]
        let vol_avg20: number | null = null
        let vol_ratio: number | null = null
        try {
          vol_avg20 = Statistics.SMA(volumes, 20)
          vol_ratio = round(vol_latest / vol_avg20)
        } catch { /* insufficient data */ }

        return {
          symbol,
          timeframe,
          bars_used: data.length,
          computed_at: new Date().toISOString(),
          price: round(price),
          atr_14: round(atr_14),
          rsi_14: round(rsi_14),
          macd_hist: round(macdResult.histogram),
          bb: {
            upper: round(bbResult.upper),
            middle: round(bbResult.middle),
            lower: round(bbResult.lower),
            width_pct: bb_width_pct,
          },
          sma50: sma50 !== null ? round(sma50) : null,
          sma200: sma200 !== null ? round(sma200) : null,
          near_sma200,
          vol_latest: round(vol_latest),
          vol_avg20: vol_avg20 !== null ? round(vol_avg20) : null,
          vol_ratio,
          stop_2atr: round(atr_14 * 2),
          stop_2p5atr: round(atr_14 * 2.5),
        }
      },
    }),

    tradeQualityScore: tool({
      description: `Score a potential trade (0-100) based on AutoAI research statistics.

Combines multiple dimensions from historical research data:
  - Support type quality (SMA200 best at 50%, round numbers useless at 28%)
  - Volume confirmation (vol_ratio > 1.5 = 66% win rate vs 47%)
  - MACD directional filter (ETH 4h: +0.21%/bar edge when hist > 0)
  - RSI position (overbought > 75 has 56% short success)
  - Session quality (US session best, Thursday weakest day)
  - Regime alignment (from regime matrix)

Input: a signalSnapshot result (or manual values). Output: score + breakdown.
This is a decision-support tool, not a trading rule. Alice decides.`,
      inputSchema: z.object({
        price: z.number().describe('Current price'),
        atr_14: z.number().describe('ATR(14) value'),
        rsi_14: z.number().describe('RSI(14) value'),
        macd_hist: z.number().describe('MACD histogram value'),
        vol_ratio: z.number().nullable().describe('Volume ratio (current/avg20)'),
        near_sma200: z.boolean().nullable().describe('Within 1.5% of SMA200'),
        sma50: z.number().nullable().describe('SMA50 value'),
        sma200: z.number().nullable().describe('SMA200 value'),
        direction: z.enum(['long', 'short']).describe('Intended trade direction'),
        symbol: z.string().optional().describe('Symbol for context (e.g. ETH/USDT)'),
      }),
      execute: async ({ price, atr_14, rsi_14, macd_hist, vol_ratio, near_sma200, sma50, sma200, direction }) => {
        const breakdown: Array<{ factor: string; score: number; max: number; note: string }> = []

        // 1. Support/Resistance quality (max 20)
        if (direction === 'long' && near_sma200) {
          breakdown.push({ factor: 'SMA200 support', score: 20, max: 20, note: 'hold rate ~50% BTC / 41% ETH' })
        } else if (direction === 'long') {
          breakdown.push({ factor: 'No SMA200 support', score: 5, max: 20, note: 'not near key support' })
        } else {
          breakdown.push({ factor: 'Short — support N/A', score: 10, max: 20, note: 'resistance stats weaker' })
        }

        // 2. Volume confirmation (max 25)
        if (vol_ratio !== null && vol_ratio > 1.5) {
          breakdown.push({ factor: 'Volume surge', score: 25, max: 25, note: `vol_ratio ${vol_ratio.toFixed(1)}x — win rate 66% vs 47%` })
        } else if (vol_ratio !== null) {
          breakdown.push({ factor: 'No volume surge', score: 5, max: 25, note: `vol_ratio ${vol_ratio.toFixed(1)}x — near random` })
        } else {
          breakdown.push({ factor: 'Volume unknown', score: 10, max: 25, note: 'no volume data' })
        }

        // 3. MACD filter (max 15)
        const macdAligned = (direction === 'long' && macd_hist > 0) || (direction === 'short' && macd_hist < 0)
        if (macdAligned) {
          breakdown.push({ factor: 'MACD aligned', score: 15, max: 15, note: `hist ${macd_hist > 0 ? '+' : ''}${macd_hist.toFixed(2)} — ETH 4h edge +0.21%` })
        } else {
          breakdown.push({ factor: 'MACD against', score: -5, max: 15, note: 'trading against momentum' })
        }

        // 4. RSI position (max 15)
        if (direction === 'long' && rsi_14 < 30) {
          breakdown.push({ factor: 'RSI oversold', score: 10, max: 15, note: `RSI ${rsi_14.toFixed(1)} — weak signal but supportive` })
        } else if (direction === 'short' && rsi_14 > 75) {
          breakdown.push({ factor: 'RSI overbought', score: 15, max: 15, note: `RSI ${rsi_14.toFixed(1)} — 56% short success at >75` })
        } else if ((direction === 'long' && rsi_14 > 70) || (direction === 'short' && rsi_14 < 30)) {
          breakdown.push({ factor: 'RSI against', score: -10, max: 15, note: `RSI ${rsi_14.toFixed(1)} — wrong side` })
        } else {
          breakdown.push({ factor: 'RSI neutral', score: 5, max: 15, note: `RSI ${rsi_14.toFixed(1)}` })
        }

        // 5. Regime alignment (max 15)
        if (sma50 !== null && sma200 !== null) {
          const bullRegime = price > sma50 && sma50 > sma200
          const bearRegime = price < sma50 && sma50 < sma200
          if ((direction === 'long' && bullRegime) || (direction === 'short' && bearRegime)) {
            breakdown.push({ factor: 'Regime aligned', score: 15, max: 15, note: direction === 'long' ? 'P > SMA50 > SMA200' : 'P < SMA50 < SMA200' })
          } else if ((direction === 'long' && bearRegime) || (direction === 'short' && bullRegime)) {
            breakdown.push({ factor: 'Regime AGAINST', score: -15, max: 15, note: 'trading against structural trend' })
          } else {
            breakdown.push({ factor: 'Regime mixed', score: 5, max: 15, note: 'range — no strong trend' })
          }
        } else {
          breakdown.push({ factor: 'Regime unknown', score: 0, max: 15, note: 'insufficient MA data' })
        }

        // 6. Session (max 10) — based on UTC hour
        const hour = new Date().getUTCHours()
        if (hour >= 16 && hour < 24) {
          breakdown.push({ factor: 'US session', score: 10, max: 10, note: 'highest avg return session' })
        } else if (hour >= 8 && hour < 16) {
          breakdown.push({ factor: 'Europe session', score: 7, max: 10, note: 'moderate quality' })
        } else {
          breakdown.push({ factor: 'Asia session', score: 3, max: 10, note: 'lowest avg return, slightly negative' })
        }

        // Day of week penalty
        const dow = new Date().getUTCDay()
        if (dow === 4) { // Thursday
          breakdown.push({ factor: 'Thursday penalty', score: -5, max: 0, note: 'weakest day statistically' })
        }

        const totalScore = Math.max(0, Math.min(100, breakdown.reduce((sum, b) => sum + b.score, 0)))

        return {
          score: totalScore,
          max_possible: 100,
          grade: totalScore >= 70 ? 'A — strong setup' : totalScore >= 50 ? 'B — acceptable' : totalScore >= 30 ? 'C — weak, size down' : 'D — avoid',
          breakdown,
          suggested_stop: {
            distance_2atr: parseFloat((atr_14 * 2).toFixed(2)),
            distance_2p5atr: parseFloat((atr_14 * 2.5).toFixed(2)),
            note: 'Use trailing stop 2ATR for exit (only positive EV method)',
          },
        }
      },
    }),
  }
}
