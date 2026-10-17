/** Public surface of the arena engine. Consumers import from here, never from src/* directly. */

export { createBattle, step, rehydrate } from './battle.js';
export { toFighter, validateChassis, combatIndex, deriveCombat } from './stats.js';
export { narrate } from './narration.js';
export { choreograph } from './choreography.js';
export { planClashInputs, choosePosture } from './ai.js';
export { CLASH_EVENTS, CLASH_WEIGHTS } from './events/index.js';
export { normalizeElement, elementMultiplier, ELEMENTS, NEUTRAL } from './elements.js';
export { ENGINE_VERSION, MAX_BATTLE_MS } from './constants.js';
export { hashSeed } from './rng.js';
