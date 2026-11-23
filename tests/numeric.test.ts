import { describe, expect, it } from 'vitest'
import {
  ValidationError,
  approximatelyEqual,
  assertFiniteNumber,
  assertNonNegativeTolerance,
  assertSafeInteger,
  clamp,
  degreesToRadians,
  radiansToDegrees
} from '../index.js'

describe('numeric validation', () => {
  it('accepts finite numbers including signed zero and subnormals', () => {
    for (const value of [-0, Number.MIN_VALUE, -Number.MAX_VALUE, 0.5]) {
      expect(() => assertFiniteNumber(value)).not.toThrow()
    }
  })

  it.each([NaN, Infinity, -Infinity, '2', 2n, null, undefined, Object(2)])(
    'rejects %s as a finite number',
    (value) => {
      expect(() => assertFiniteNumber(value, 'operand')).toThrow(ValidationError)
      expect(() => assertFiniteNumber(value, 'operand')).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', details: { parameter: 'operand' } })
      )
    }
  )

  it('accepts safe integer endpoints and rejects numbers outside the safe integer domain', () => {
    for (const value of [Number.MIN_SAFE_INTEGER, -0, Number.MAX_SAFE_INTEGER]) {
      expect(() => assertSafeInteger(value)).not.toThrow()
    }
    for (const value of [Number.MIN_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1, 1.5, Infinity, '1']) {
      expect(() => assertSafeInteger(value)).toThrow(ValidationError)
    }
  })

  it('accepts finite nonnegative tolerances without coercing other values', () => {
    for (const value of [-0, Number.MIN_VALUE, Number.MAX_VALUE]) {
      expect(() => assertNonNegativeTolerance(value)).not.toThrow()
    }
    for (const value of [-Number.MIN_VALUE, NaN, Infinity, '0', null]) {
      expect(() => assertNonNegativeTolerance(value)).toThrow(ValidationError)
    }
  })
})

describe('approximatelyEqual', () => {
  it('accepts exact equality including signed zeros with both tolerances disabled', () => {
    const options = { absoluteTolerance: 0, relativeTolerance: 0 }
    expect(approximatelyEqual(-0, 0, options)).toBe(true)
    expect(approximatelyEqual(Number.MAX_VALUE, Number.MAX_VALUE, options)).toBe(true)
    expect(approximatelyEqual(1, 1 + Number.EPSILON, options)).toBe(false)
  })

  it.each([1e-200, 1, 1e200])('uses the default relative tolerance at scale %s', (scale) => {
    expect(approximatelyEqual(scale, scale * (1 + 5e-13))).toBe(true)
    expect(approximatelyEqual(scale, scale * (1 + 5e-12))).toBe(false)
  })

  it('compares near zero using an explicitly supplied absolute tolerance', () => {
    expect(approximatelyEqual(0, 1e-15)).toBe(false)
    expect(approximatelyEqual(0, -1e-15, { absoluteTolerance: 1e-15 })).toBe(true)
    expect(approximatelyEqual(0, -1e-14, { absoluteTolerance: 1e-15 })).toBe(false)
  })

  it('uses the larger tolerance and includes its boundary', () => {
    expect(approximatelyEqual(8, 6, { absoluteTolerance: 1, relativeTolerance: 0.25 })).toBe(true)
    expect(approximatelyEqual(6, 8, { absoluteTolerance: 2, relativeTolerance: 0.125 })).toBe(true)
    expect(approximatelyEqual(8, 6, { absoluteTolerance: 1, relativeTolerance: 0.125 })).toBe(false)
  })

  it('does not round a subnormal relative threshold up to the full difference', () => {
    const smallest = Number.MIN_VALUE
    expect(approximatelyEqual(smallest, 0, { relativeTolerance: 0.75 })).toBe(false)
    expect(approximatelyEqual(smallest, 0, { relativeTolerance: 1 })).toBe(true)
    expect(approximatelyEqual(2 * smallest, smallest, { relativeTolerance: 0.5 })).toBe(true)
  })

  it('handles opposite-sign differences and tolerance products beyond the finite range', () => {
    const largest = Number.MAX_VALUE
    expect(approximatelyEqual(largest, -largest, { absoluteTolerance: largest, relativeTolerance: 1.5 })).toBe(false)
    expect(approximatelyEqual(-largest, largest, { relativeTolerance: 2 })).toBe(true)
    expect(approximatelyEqual(largest, -largest / 2, { relativeTolerance: 1.5 })).toBe(true)
  })

  it('reports the offending comparand for nonfinite or nonnumeric input', () => {
    expect(() => approximatelyEqual(NaN, 0)).toThrow(expect.objectContaining({ details: { parameter: 'a' } }))
    expect(() => approximatelyEqual(0, Infinity)).toThrow(expect.objectContaining({ details: { parameter: 'b' } }))
    expect(() => approximatelyEqual(0, '0' as unknown as number)).toThrow(ValidationError)
  })

  it('validates both tolerances even when the comparands are exactly equal', () => {
    expect(() => approximatelyEqual(1, 1, { absoluteTolerance: -1 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: { parameter: 'absoluteTolerance' } })
    )
    expect(() => approximatelyEqual(1, 1, { relativeTolerance: Infinity })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: { parameter: 'relativeTolerance' } })
    )
  })
})

describe('clamp', () => {
  it.each([
    [-3, -2, 4, -2],
    [5, -2, 4, 4],
    [0.5, -2, 4, 0.5],
    [-2, -2, 4, -2],
    [4, -2, 4, 4],
    [Number.MAX_VALUE, 3, 3, 3],
    [-0, 0, 4, -0],
    [1, -2, -0, -0]
  ])('clamps %s to the inclusive interval [%s, %s]', (value, min, max, expected) => {
    expect(clamp(value, min, max)).toBe(expected)
  })

  it('rejects reversed bounds with the offending parameter', () => {
    expect(() => clamp(2, 3, 1)).toThrow(expect.objectContaining({
      code: 'VALIDATION_ERROR',
      details: { parameter: 'max', min: 3, max: 1 }
    }))
  })

  it('requires a finite number for the value and both bounds', () => {
    expect(() => clamp(NaN, 0, 2)).toThrow(expect.objectContaining({ details: { parameter: 'value' } }))
    expect(() => clamp(1, -Infinity, 2)).toThrow(expect.objectContaining({ details: { parameter: 'min' } }))
    expect(() => clamp(1, 0, Infinity)).toThrow(expect.objectContaining({ details: { parameter: 'max' } }))
    expect(() => clamp('1' as unknown as number, 0, 2)).toThrow(ValidationError)
  })
})

describe('angle conversion', () => {
  it.each([
    [-90, -Math.PI / 2],
    [30, Math.PI / 6],
    [180, Math.PI],
    [450, 5 * Math.PI / 2]
  ])('converts %s degrees to radians and back', (degrees, radians) => {
    expect(approximatelyEqual(degreesToRadians(degrees), radians)).toBe(true)
    expect(approximatelyEqual(radiansToDegrees(radians), degrees)).toBe(true)
  })

  it('preserves signed zero and allows underflow', () => {
    expect(degreesToRadians(-0)).toBe(-0)
    expect(radiansToDegrees(-0)).toBe(-0)
    expect(degreesToRadians(-Number.MIN_VALUE)).toBe(-0)
    expect(radiansToDegrees(Number.MIN_VALUE)).toBe(57 * Number.MIN_VALUE)
  })

  it('converts large finite angles without intermediate overflow', () => {
    expect(approximatelyEqual(degreesToRadians(Number.MAX_VALUE), 3.1375664143845866e306)).toBe(true)
    expect(approximatelyEqual(radiansToDegrees(2e306), 1.1459155902616465e308)).toBe(true)
  })

  it('throws a range error when the degree result overflows', () => {
    expect(() => radiansToDegrees(Number.MAX_VALUE)).toThrow(RangeError)
    expect(() => radiansToDegrees(-Number.MAX_VALUE)).toThrow(RangeError)
  })

  it('rejects nonfinite inputs without coercion', () => {
    expect(() => degreesToRadians(Infinity)).toThrow(expect.objectContaining({ details: { parameter: 'degrees' } }))
    expect(() => radiansToDegrees(NaN)).toThrow(expect.objectContaining({ details: { parameter: 'radians' } }))
    expect(() => radiansToDegrees('1' as unknown as number)).toThrow(ValidationError)
  })
})
