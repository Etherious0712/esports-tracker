/**
 * All times are stored as UTC ISO 8601 strings throughout the system.
 * These helpers convert to local time only at the point of display.
 * Never localise in the storage or business-logic layers.
 */

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const TIME_ONLY_FORMAT = new Intl.DateTimeFormat(undefined, {
  timeStyle: 'short',
});

const DATE_ONLY_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

/** Formats a UTC ISO 8601 string as a localised date + time string. */
export function formatLocalDateTime(utcIso: string): string {
  return DATE_TIME_FORMAT.format(new Date(utcIso));
}

/** Formats a UTC ISO 8601 string as a localised time-only string. */
export function formatLocalTime(utcIso: string): string {
  return TIME_ONLY_FORMAT.format(new Date(utcIso));
}

/** Formats a UTC ISO 8601 string as a localised date-only string. */
export function formatLocalDate(utcIso: string): string {
  return DATE_ONLY_FORMAT.format(new Date(utcIso));
}

/** Returns the current time as a UTC ISO 8601 string. Used for cache timestamps. */
export function nowUtcIso(): string {
  return new Date().toISOString();
}

/**
 * Returns true if the UTC ISO 8601 string falls on the same calendar day
 * as the reference date in the local timezone. Useful for grouping matches.
 */
export function isSameLocalDay(utcIso: string, reference: Date = new Date()): boolean {
  const d = new Date(utcIso);
  return (
    d.getFullYear() === reference.getFullYear() &&
    d.getMonth() === reference.getMonth() &&
    d.getDate() === reference.getDate()
  );
}
