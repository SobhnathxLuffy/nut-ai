import { describe, expect, it } from 'vitest'

import { TUTORIAL_CARDS } from './content'

/**
 * The walkthrough's CONTENT contract (owner item #3): five concept cards that
 * teach the real feature names, plus the honesty locks — the offline card
 * must never claim AI works offline, and the "needs internet" copy must be
 * explicit. Content is data, so these run in the plain node environment.
 */

/** Every string a card renders — title, body and bullets, in one pool. */
function cardText(card: (typeof TUTORIAL_CARDS)[number]): string {
  return [card.title, card.body, ...card.points].join('\n')
}

const ALL_TEXT = TUTORIAL_CARDS.map(cardText).join('\n')

describe('coverage — one card per concept area', () => {
  it('ships exactly the five required areas, in teaching order', () => {
    expect(TUTORIAL_CARDS.map((c) => c.id)).toEqual(['home', 'food', 'training', 'ai', 'offline'])
  })

  it('every card is complete: icon, title, body and at least two points', () => {
    for (const card of TUTORIAL_CARDS) {
      expect(card.icon.length, card.id).toBeGreaterThan(0)
      expect(card.title.length, card.id).toBeGreaterThan(0)
      expect(card.body.length, card.id).toBeGreaterThan(0)
      expect(card.points.length, card.id).toBeGreaterThanOrEqual(2)
      for (const point of card.points) expect(point.length, card.id).toBeGreaterThan(0)
    }
  })
})

describe('source-lock — the cards name the REAL features the user will find', () => {
  const required: Array<[string, RegExp]> = [
    // Home
    ['hero card concept', /Calories left/],
    ['honest over-state', /Calories over/],
    ['per-meal breakdown', /Remaining by meal/],
    ['target card', /Your target/],
    ['timeline', /Daily timeline/],
    // Food
    ['primary search entry', /Log food/],
    ['bundled indian KB', /Indian dishes/],
    ['recipes', /Recipes/],
    ['custom foods', /Custom food/],
    ['saved meals', /Saved meals/],
    ['one-tap relog', /Copy yesterday/],
    ['camera modes', /Barcode/],
    // Train
    ['quick session', /Start empty workout/],
    ['reusable templates', /Create routine/],
    ['programs', /Programs & schedule/],
    // AI
    ['assistant entry', /AI Assistant/],
    ['division of labor', /deterministic/],
    ['provider management', /Provider & key/],
  ]
  it.each(required)('%s appears by its real name', (_name, re) => {
    expect(ALL_TEXT).toMatch(re)
  })

  it('the home card explains adaptive targets', () => {
    const home = TUTORIAL_CARDS.find((c) => c.id === 'home')!
    expect(cardText(home)).toMatch(/adapt/i)
  })

  it('the training card keeps the journal promise the Train tab itself makes', () => {
    const training = TUTORIAL_CARDS.find((c) => c.id === 'training')!
    expect(cardText(training)).toMatch(/journal|history|every set/i)
  })
})

describe('honesty — the offline card never claims cloud AI works offline', () => {
  it('no card string pairs "offline" with AI, cloud, assistant, photo or scan', () => {
    for (const card of TUTORIAL_CARDS) {
      for (const text of [card.title, card.body, ...card.points]) {
        if (/offline/i.test(text)) {
          expect(text, `${card.id} pairs offline with a cloud concept`).not.toMatch(
            /\bAI\b|\bcloud\b|assistant|photo|\bscan\b/i,
          )
        }
      }
    }
  })

  it('states the internet requirement explicitly, more than once', () => {
    expect(ALL_TEXT.match(/needs? internet/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('the offline card keeps the core-offline claims concrete (search, logging, training, history, math)', () => {
    const offline = TUTORIAL_CARDS.find((c) => c.id === 'offline')!
    const text = cardText(offline)
    expect(text).toMatch(/search/i)
    expect(text).toMatch(/log/i)
    expect(text).toMatch(/train/i)
    expect(text).toMatch(/calculation/i)
  })

  it('tells the user the tour is replayable from Profile', () => {
    expect(ALL_TEXT).toMatch(/Replay the tutorial/)
  })
})
