/**
 * Watch Level — price alert management for Alice.
 *
 * Alice sets price levels she cares about. During heartbeat/cron,
 * she reads the watch list and checks current prices against it.
 * When a level is hit, she triggers her decision workflow.
 *
 * Storage: data/brain/watch-levels.json (file-driven, no database)
 */

import { tool } from 'ai'
import { z } from 'zod'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const WATCH_FILE = join(process.env.HOME ?? '', 'OpenAlice', 'data', 'brain', 'watch-levels.json')

interface WatchLevel {
  id: string
  symbol: string
  level: number
  direction: 'above' | 'below' | 'touch'
  note: string
  created: string
  triggered?: string
  active: boolean
}

function loadLevels(): WatchLevel[] {
  if (!existsSync(WATCH_FILE)) return []
  try {
    return JSON.parse(readFileSync(WATCH_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveLevels(levels: WatchLevel[]) {
  writeFileSync(WATCH_FILE, JSON.stringify(levels, null, 2))
}

export function createWatchTools() {
  return {
    setWatchLevel: tool({
      description: `Set a price watch level. When price reaches this level, Alice should evaluate the trade setup.

Usage: set a level you care about (e.g. support zone, breakout level).
During heartbeat, check active levels with getWatchLevels and compare against current prices.

direction:
  "touch" — within 0.5% of level (for support/resistance)
  "above" — price crosses above level (for breakouts)
  "below" — price crosses below level (for breakdowns)`,
      inputSchema: z.object({
        symbol: z.string().describe('Symbol, e.g. "ETH/USDT:USDT"'),
        level: z.number().describe('Price level to watch'),
        direction: z.enum(['above', 'below', 'touch']).describe('Trigger condition'),
        note: z.string().describe('Why this level matters, e.g. "SMA200 support, look for entry"'),
      }),
      execute: async ({ symbol, level, direction, note }) => {
        const levels = loadLevels()
        const id = `${symbol.replace(/[/:]/g, '')}_${level}_${Date.now().toString(36)}`
        const entry: WatchLevel = {
          id,
          symbol,
          level,
          direction,
          note,
          created: new Date().toISOString(),
          active: true,
        }
        levels.push(entry)
        saveLevels(levels)
        return { status: 'ok', id, message: `Watching ${symbol} ${direction} $${level}`, total_active: levels.filter(l => l.active).length }
      },
    }),

    getWatchLevels: tool({
      description: `Get all active watch levels. Use during heartbeat to check if any levels are near current prices.

Returns the list with level, direction, note. Compare each against current price:
  - "touch": triggered if |price - level| / level < 0.005
  - "above": triggered if price > level
  - "below": triggered if price < level

When triggered, run signalSnapshot on that symbol to evaluate the setup.`,
      inputSchema: z.object({
        symbol: z.string().optional().describe('Filter by symbol (optional, returns all if omitted)'),
        active_only: z.boolean().default(true).describe('Only return active levels'),
      }),
      execute: async ({ symbol, active_only }) => {
        let levels = loadLevels()
        if (active_only) levels = levels.filter(l => l.active)
        if (symbol) levels = levels.filter(l => l.symbol === symbol)
        return { levels, count: levels.length }
      },
    }),

    checkWatchLevels: tool({
      description: `Check all active watch levels against a current price. Returns which levels are triggered.

Call this with the current price of a symbol. It will return:
  - triggered: levels that are hit → Alice should run signalSnapshot and evaluate
  - approaching: levels within 2% → heads up
  - clear: levels far away

Triggered levels are automatically marked as triggered (not deactivated — Alice decides).`,
      inputSchema: z.object({
        symbol: z.string().describe('Symbol to check'),
        current_price: z.number().describe('Current price of the symbol'),
      }),
      execute: async ({ symbol, current_price }) => {
        const levels = loadLevels()
        const relevant = levels.filter(l => l.active && l.symbol === symbol)

        const triggered: WatchLevel[] = []
        const approaching: Array<WatchLevel & { distance_pct: number }> = []
        const clear: WatchLevel[] = []

        for (const l of relevant) {
          const dist = (current_price - l.level) / l.level
          const absDist = Math.abs(dist)

          let isTriggered = false
          if (l.direction === 'touch' && absDist < 0.005) isTriggered = true
          if (l.direction === 'above' && current_price > l.level) isTriggered = true
          if (l.direction === 'below' && current_price < l.level) isTriggered = true

          if (isTriggered) {
            l.triggered = new Date().toISOString()
            triggered.push(l)
          } else if (absDist < 0.02) {
            approaching.push({ ...l, distance_pct: parseFloat((dist * 100).toFixed(2)) })
          } else {
            clear.push(l)
          }
        }

        // Save triggered timestamps
        if (triggered.length > 0) saveLevels(levels)

        return {
          symbol,
          current_price,
          triggered: triggered.map(l => ({ id: l.id, level: l.level, direction: l.direction, note: l.note })),
          approaching: approaching.map(l => ({ id: l.id, level: l.level, distance_pct: l.distance_pct, note: l.note })),
          clear_count: clear.length,
          action: triggered.length > 0
            ? `🔔 ${triggered.length} level(s) triggered! Run signalSnapshot for ${symbol} to evaluate.`
            : approaching.length > 0
              ? `⚠️ ${approaching.length} level(s) approaching. Stay alert.`
              : '✅ All levels clear.',
        }
      },
    }),

    removeWatchLevel: tool({
      description: 'Remove or deactivate a watch level by ID.',
      inputSchema: z.object({
        id: z.string().describe('Level ID to remove'),
        deactivate_only: z.boolean().default(false).describe('If true, mark inactive instead of deleting'),
      }),
      execute: async ({ id, deactivate_only }) => {
        const levels = loadLevels()
        if (deactivate_only) {
          const level = levels.find(l => l.id === id)
          if (level) level.active = false
          saveLevels(levels)
          return { status: 'deactivated', id }
        } else {
          const filtered = levels.filter(l => l.id !== id)
          saveLevels(filtered)
          return { status: 'deleted', id }
        }
      },
    }),
  }
}
