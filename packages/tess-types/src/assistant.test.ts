import { describe, expect, it } from 'vitest';
import { ASSISTANT_STATES, isRequestedState } from './index.js';

describe('isRequestedState', () => {
  it('acepta los seis estados que el integrador puede pedir', () => {
    for (const state of ASSISTANT_STATES) {
      if (state === 'offline') continue;
      expect(isRequestedState(state)).toBe(true);
    }
  });

  it('rechaza offline porque es derivado de la conectividad', () => {
    expect(isRequestedState('offline')).toBe(false);
  });

  it('rechaza valores que no son del vocabulario', () => {
    expect(isRequestedState('thinking ')).toBe(false);
    expect(isRequestedState(42)).toBe(false);
    expect(isRequestedState(null)).toBe(false);
  });
});
