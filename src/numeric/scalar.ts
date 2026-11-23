import { ValidationError } from '../core/errors.js'
import { assertFiniteNumber } from './validation.js'

const RADIANS_PER_DEGREE = Math.PI / 180
const DEGREES_PER_RADIAN = 180 / Math.PI

/** Limit a finite value to the inclusive interval [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  assertFiniteNumber(value, 'value')
  assertFiniteNumber(min, 'min')
  assertFiniteNumber(max, 'max')

  if (max < min) {
    throw new ValidationError('max must be greater than or equal to min.', { parameter: 'max', min, max })
  }

  if (value < min) return min
  if (value > max) return max
  return value
}

/** Convert a finite angle from degrees to radians. */
export function degreesToRadians(degrees: number): number {
  assertFiniteNumber(degrees, 'degrees')
  return degrees * RADIANS_PER_DEGREE
}

/** Convert a finite angle from radians to degrees, throwing if the result overflows. */
export function radiansToDegrees(radians: number): number {
  assertFiniteNumber(radians, 'radians')
  const degrees = radians * DEGREES_PER_RADIAN

  if (!Number.isFinite(degrees)) {
    throw new RangeError('The converted angle exceeds the finite degree range.')
  }

  return degrees
}
