/** Safe, Docket-owned copy for persisted Lattice settlement and interactive failure codes. */
const COPY: Readonly<Record<string, string>> = {
  access_lost: 'Athena stopped because you no longer have access to the assigned work.',
  oauth_invalid: 'Athena stopped because the Lattice connection needs authorization again.',
  scope_missing: 'Athena stopped because the Lattice connection does not grant compute access.',
  result_decryption_failed: 'Athena could not verify the encrypted result returned by Lattice.',
  result_key_invalid: 'Athena could not open the saved key for this Lattice assignment.',
  runtime_key_expired: 'Athena stopped because the Mac Studio work key expired.',
  runtime_not_found: 'Athena could not find the selected Mac Studio in this Lattice account.',
  submission_rejected: 'Athena could not submit this assignment to the selected Mac Studio.',
  relay_unavailable: 'Athena is waiting for the Lovelace Lattice relay to respond.',
  unknown_work: 'Athena stopped because Lattice no longer recognizes this assignment.',
  work_expired: 'Athena did not receive the Lattice result before it expired.',
  execution_failed: 'Athena could not finish the assignment on the selected Mac Studio.',
  result_invalid: 'Athena received a Lattice result that did not contain a usable report.',
  task_comment_failed: 'Athena could not add the Lattice result to the assigned task.',
  device_offline:
    'That computer is not reachable. Wake it and make sure Lattice is running, then try again.',
};

/** Unknown codes cannot introduce provider or stored prose into the owner's activity stream. */
export function knownLatticeFailureMessage(code: unknown): string | null {
  return typeof code === 'string' && Object.hasOwn(COPY, code) ? (COPY[code] ?? null) : null;
}

/**
 * Resolve a persisted Lattice failure code to safe activity and session copy.
 *
 * @param code - Docket's stable settlement code.
 * @returns A Docket-owned message, including a generic fallback for unknown codes.
 */
export function failureMessage(code: string): string {
  return knownLatticeFailureMessage(code) ?? 'Athena could not finish the Lattice assignment.';
}
