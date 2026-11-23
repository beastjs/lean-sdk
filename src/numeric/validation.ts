import { ValidationError } from '../core/errors.js'

/** Require a finite JavaScript number without coercion. */
export function assertFiniteNumber(value: unknown, parameter = 'value'): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${parameter} must be a finite number.`, { parameter })
  }
}

/** Require an integer in the safe integer range. */
export function assertSafeInteger(value: unknown, parameter = 'value'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ValidationError(`${parameter} must be a safe integer.`, { parameter })
  }
}

/** Require a finite tolerance greater than or equal to zero. */
export function assertNonNegativeTolerance(value: unknown, parameter = 'tolerance'): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${parameter} must be a finite, nonnegative number.`, { parameter })
  }
}
