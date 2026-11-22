import { describe, expect, it } from 'vitest'

import {
  LeanCompilationError,
  LeanExecutionError,
  LeanMathDisposedError,
  LeanMathError,
  LeanModuleLoadError,
  LeanTimeoutError,
  LeanWorkerError,
  RuntimeInitializationError,
  ValidationError,
  isLeanMathError,
  normalizeError
} from '../src/core/errors'

describe('SDK Errors', () => {
  it('creates a base SDK error', () => {
    const error = new LeanMathError('Something went wrong')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('LeanMathError')
    expect(error.code).toBe('SDK_ERROR')
    expect(error.message).toBe('Something went wrong')
  })

  it('supports structured details', () => {
    const error = new ValidationError('Invalid input', {
      field: 'expression',
      value: ''
    })

    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.details?.field).toBe('expression')
    expect(error.details?.value).toBe('')
  })

  it('preserves the original error cause', () => {
    const cause = new Error('Original failure')
    const error = new RuntimeInitializationError('Runtime failed', cause)

    expect(error.cause).toBe(cause)
    expect(error.name).toBe('RuntimeInitializationError')
  })

  it('creates compilation errors with source and diagnostics', () => {
    const error = new LeanCompilationError('Compilation failed', {
      source: 'theorem example : True := by trivial',
      diagnostics: 'Unexpected token'
    })

    expect(error.code).toBe('COMPILATION_ERROR')
    expect(error.source).toContain('theorem example')
    expect(error.diagnostics).toBe('Unexpected token')
  })

  it('creates execution errors', () => {
    const error = new LeanExecutionError('Execution failed', {
      line: 10
    })

    expect(error.code).toBe('EXECUTION_ERROR')
    expect(error.details?.line).toBe(10)
  })

  it('stores timeout duration', () => {
    const error = new LeanTimeoutError(5000)

    expect(error.code).toBe('TIMEOUT_ERROR')
    expect(error.timeoutMs).toBe(5000)
    expect(error.message).toContain('5000ms')
  })

  it('creates worker errors', () => {
    const error = new LeanWorkerError('Worker crashed')

    expect(error.code).toBe('WORKER_ERROR')
    expect(error.name).toBe('LeanWorkerError')
  })

  it('creates module loading errors', () => {
    const error = new LeanModuleLoadError('Mathlib.Data.Real.Basic')

    expect(error.code).toBe('MODULE_LOAD_ERROR')
    expect(error.moduleName).toBe('Mathlib.Data.Real.Basic')
    expect(error.message).toContain('Mathlib.Data.Real.Basic')
  })

  it('creates disposed errors', () => {
    const error = new LeanMathDisposedError()

    expect(error.code).toBe('DISPOSED_ERROR')
    expect(error.name).toBe('LeanMathDisposedError')
  })

  it('identifies SDK errors', () => {
    expect(isLeanMathError(new ValidationError('Invalid'))).toBe(true)
    expect(isLeanMathError(new Error('Regular error'))).toBe(false)
    expect(isLeanMathError('error')).toBe(false)
  })

  it('normalizes unknown error values', () => {
    expect(normalizeError('Something failed').message).toBe('Something failed')

    expect(normalizeError(null).message).toBe('An unexpected error occurred.')

    expect(normalizeError({ reason: 'failed' }).message).toBe('{"reason":"failed"}')
  })

  it('serializes errors to JSON', () => {
    const error = new ValidationError('Invalid expression', {
      field: 'expression'
    })

    const serialized = error.toJSON()

    expect(serialized.name).toBe('ValidationError')
    expect(serialized.code).toBe('VALIDATION_ERROR')
    expect(serialized.message).toBe('Invalid expression')
    expect(serialized.details?.field).toBe('expression')
  })
})
