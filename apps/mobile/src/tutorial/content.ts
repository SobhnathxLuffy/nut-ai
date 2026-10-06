import type { IconName } from '../components/Icon'

/**
 * The walkthrough's content, as data (owner item #3): five cards, one concept
 * area each — Home, Food, Train, AI, Offline-first. It is a CARD WALKTHROUGH
 * by deliberate choice, not a spotlight overlay: a spotlight must coordinate
 * with the live screens' geometry and labels, so every redesign elsewhere
 * breaks it (the brittleness the owner rejected). These cards teach the real
 * names of the real features instead, so copy can drift-checked against the
 * app by test (content.test.ts source-locks every feature name below).
 *
 * Honesty rules the tests enforce here:
 *   - no string may pair "offline" with AI/cloud/scan/photo — the AI card and
 *     the offline card both state that AI features need internet;
 *   - every feature name is the label the user will actually find on screen.
 *
 * Type-only Icon import: this module stays render-free so the node suite can
 * lock it without RN.
 */

export interface TutorialCard {
  id: 'home' | 'food' | 'training' | 'ai' | 'offline'
  icon: IconName
  title: string
  body: string
  points: readonly string[]
}

export const TUTORIAL_CARDS: readonly TutorialCard[] = [
  {
    id: 'home',
    icon: 'flame',
    title: 'Home: your day at a glance',
    body:
      'The hero card is your day in one number: the ring counts what you have eaten, and the big figure is what remains of your target.',
    points: [
      '"Calories left" counts down as you log — go past the target and it says "Calories over", never hidden.',
      'Tap the card to expand "Remaining by meal": a quarter of your day per meal — a guide, not a budget.',
      'Protein, Carbs and Fat show eaten against target, and the "Your target" card states today\'s number — it adapts as you log.',
      'The "Daily timeline" lists every meal; tap one to open or edit it.',
    ],
  },
  {
    id: 'food',
    icon: 'bowl',
    title: 'Food: log anything in seconds',
    body:
      'The Food tab leads with a large "Log food" search across the food databases shipped inside the app.',
    points: [
      'The quick actions: "Scan food", "Indian dishes" (362 curated dishes), "Recipes", "Custom food" and "Copy yesterday" to re-log a whole day.',
      '"Scan food" opens the camera with Food, Barcode, Label and Receipt modes — every scan is reviewed with you before anything is saved.',
      'Search, dishes, recipes and logging all run on bundled data: these work offline.',
    ],
  },
  {
    id: 'training',
    icon: 'dumbbell',
    title: 'Train: quick start, or plan ahead',
    body: 'The Train tab is the gym door: start now, or build the plan first.',
    points: [
      '"Start empty workout" opens a session you fill in as you go.',
      '"Create routine" saves a reusable workout template, and "Programs & schedule" places a routine on each weekday across weeks.',
      'Your journal keeps every set — history and progress stay on this device.',
    ],
  },
  {
    id: 'ai',
    icon: 'sparkles',
    title: 'AI interprets, Nut AI calculates',
    body:
      'AI features read, describe and suggest. Every number is still Nut AI\'s own deterministic math — a model never invents a calorie.',
    points: [
      'The + button\'s "AI Assistant" chats about your day, and "Scan food" can read a photo of a meal.',
      'Bring your own key or gateway: Profile → "Provider & key" — change or remove it anytime.',
      'AI features need internet. Core logging never does.',
    ],
  },
  {
    id: 'offline',
    icon: 'check',
    title: 'Built offline-first',
    body: 'Your data lives on this device — no account, no server, nothing to breach.',
    points: [
      'Search, meal logging, training, history and every calculation run on the phone; the food database ships inside the app.',
      'The AI and cloud features are the exception: they need internet, and they are never required.',
      'Replay this tour anytime: Profile → "Replay the tutorial".',
    ],
  },
]
