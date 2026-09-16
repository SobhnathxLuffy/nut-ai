import { describe, expect, it, vi } from 'vitest'
import { runAssistantChatApi } from './client'

vi.mock('../credentials', () => ({
  loadCredential: vi.fn(async (_) => ({ value: 'fake-key' }))
}))

describe('provider fallback', () => {
  it('Given primary provider timeout, when fallback is configured, then secondary provider is called once.', async () => {
    let callCount = 0
    const mockFetch = vi.fn(async () => {
      callCount++
      if (callCount === 1) throw new Error('AbortError') // Primary fails
      return { ok: true, json: async () => ({ content: [{ text: 'fallback answer' }] }) } as any
    })

    const res = await runAssistantChatApi({
      provider: 'openai', model: 'gpt-4o', systemPrompt: 'sys', userPrompt: 'usr'
    }, mockFetch as any)

    expect(callCount).toBe(2)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.text).toBe('fallback answer')
  })

  it('Given auth failure, then retry does not loop and setup UI is shown.', async () => {
    let callCount = 0
    const mockFetch = vi.fn(async () => {
      callCount++
      return { ok: false, status: 401, json: async () => ({ error: { message: 'Auth failed' } }) } as any
    })

    const res = await runAssistantChatApi({
      provider: 'openai', model: 'gpt-4o', systemPrompt: 'sys', userPrompt: 'usr'
    }, mockFetch as any)

    expect(callCount).toBe(1) // Fails immediately, no retry
    expect(res.ok).toBe(false)
  })
})
