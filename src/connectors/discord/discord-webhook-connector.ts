/**
 * Discord webhook outbound connector.
 *
 * Delivers messages to a Discord channel via webhook URL.
 * Handles automatic text chunking for Discord's 2000-char limit.
 */

import type { Connector, ConnectorCapabilities, SendPayload, SendResult } from '../types.js'

export const MAX_MESSAGE_LENGTH = 2000

export class DiscordWebhookConnector implements Connector {
  readonly channel = 'discord'
  readonly to: string
  readonly capabilities: ConnectorCapabilities = { push: true, media: false }

  constructor(private readonly webhookUrl: string) {
    this.to = 'webhook'
  }

  async send(payload: SendPayload): Promise<SendResult> {
    const text = payload.text.trim()
    if (!text) return { delivered: false }

    const chunks = this.chunk(text)
    for (const chunk of chunks) {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunk }),
      })
      if (!res.ok) {
        console.error(`discord webhook: ${res.status} ${res.statusText}`)
        return { delivered: false }
      }
      // Discord rate limit: small delay between chunks
      if (chunks.length > 1) await new Promise((r) => setTimeout(r, 500))
    }

    return { delivered: true }
  }

  private chunk(text: string): string[] {
    if (text.length <= MAX_MESSAGE_LENGTH) return [text]
    const chunks: string[] = []
    let remaining = text
    while (remaining.length > 0) {
      if (remaining.length <= MAX_MESSAGE_LENGTH) {
        chunks.push(remaining)
        break
      }
      // Try to break at newline
      let cut = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH)
      if (cut <= 0) cut = MAX_MESSAGE_LENGTH
      chunks.push(remaining.slice(0, cut))
      remaining = remaining.slice(cut).trimStart()
    }
    return chunks
  }
}
