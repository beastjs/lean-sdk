import { assertFiniteNumber, assertNonNegativeTolerance } from './validation.js'

export interface ApproximateEqualityOptions {
  /** Absolute tolerance in the units of the values. Defaults to 0. */
  absoluteTolerance?: number
  /** Tolerance relative to the larger magnitude. Defaults to 1e-12. */
  relativeTolerance?: number
}

/** Check whether two finite numbers differ by at most the absolute or relative tolerance. */
export function approximatelyEqual(
  a: number,
  b: number,
  { absoluteTolerance = 0, relativeTolerance = 1e-12 }: ApproximateEqualityOptions = {}
): boolean {
  assertFiniteNumber(a, 'a')
  assertFiniteNumber(b, 'b')
  assertNonNegativeTolerance(absoluteTolerance, 'absoluteTolerance')
  assertNonNegativeTolerance(relativeTolerance, 'relativeTolerance')

  const difference = Math.abs(a - b)
  if (difference <= absoluteTolerance) return true

  const scale = Math.max(Math.abs(a), Math.abs(b))

  // Divide instead of multiplying the tolerance, which can overflow or round up a subnormal.
  // If subtraction overflowed, normalize the operands before subtracting them.
  const relativeDifference = Number.isFinite(difference)
    ? difference / scale
    : Math.abs(a / scale - b / scale)

  return relativeDifference <= relativeTolerance
}
