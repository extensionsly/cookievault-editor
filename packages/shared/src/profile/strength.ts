/**
 * Passphrase strength evaluation via zxcvbn-ts.
 *
 * Lives at a SEPARATE subpath export (`@cookievault/shared/profile/strength`)
 * and is NOT re-exported from the package root index — zxcvbn ships ~150 KB
 * of dictionaries we don't want pulled into the popup bundle. Only the
 * options page imports this.
 *
 * Init is LAZY: the first call to `evaluatePassphrase` configures zxcvbn
 * with the English dictionaries. No top-level side effects, so the import
 * itself is tree-shakeable to nothing if unused.
 */

import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';

/** Industry threshold for "acceptable": ≥ 3 ≈ 10^10 guesses, multi-day offline. */
export const STRONG_SCORE_THRESHOLD = 3;

export type ZxcvbnScore = 0 | 1 | 2 | 3 | 4;

export interface PassphraseStrength {
  score: ZxcvbnScore;
  isStrong: boolean;
  /** Short, human-readable label. */
  label: 'very weak' | 'weak' | 'fair' | 'strong' | 'excellent';
  /** zxcvbn's primary warning, may be empty. */
  warning: string;
  /** Actionable improvement suggestions from zxcvbn. */
  suggestions: readonly string[];
  /**
   * Estimated crack time at offline-slow-hash (10k guesses/sec). This is
   * the regime that matches our threat model: an attacker with the
   * encrypted vault doing PBKDF2 offline.
   */
  crackTimeDisplay: string;
}

let initialised = false;
function ensureInitialised(): void {
  if (initialised) return;
  zxcvbnOptions.setOptions({
    graphs: adjacencyGraphs,
    dictionary: commonDictionary,
  });
  initialised = true;
}

const SCORE_LABELS: Record<ZxcvbnScore, PassphraseStrength['label']> = {
  0: 'very weak',
  1: 'weak',
  2: 'fair',
  3: 'strong',
  4: 'excellent',
};

/**
 * Score a passphrase. Empty input returns a neutral very-weak state
 * without calling zxcvbn (it would dictionary-warn on empty strings).
 */
export function evaluatePassphrase(input: string): PassphraseStrength {
  if (input.length === 0) {
    return {
      score: 0,
      isStrong: false,
      label: 'very weak',
      warning: '',
      suggestions: [],
      crackTimeDisplay: 'instant',
    };
  }
  ensureInitialised();
  const result = zxcvbn(input);
  const score = result.score as ZxcvbnScore;
  return {
    score,
    isStrong: score >= STRONG_SCORE_THRESHOLD,
    label: SCORE_LABELS[score],
    warning: result.feedback.warning ?? '',
    suggestions: result.feedback.suggestions ?? [],
    crackTimeDisplay: String(result.crackTimesDisplay.offlineSlowHashing1e4PerSecond ?? 'unknown'),
  };
}
