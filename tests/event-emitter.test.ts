import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from '../src/core/event-emitter'

interface SDKEvents {
  ready: []
  error: [error: Error]
  progress: [percentage: number, message: string]
  data: [payload: { value: number }]
}

describe('EventEmitter', () => {
  it('emits typed events and arguments', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const listener = vi.fn()

    emitter.on('progress', listener)
    emitter.emit('progress', 50, 'Loading')

    expect(listener).toHaveBeenCalledWith(50, 'Loading')
  })

  it('returns false when no listeners exist', () => {
    const emitter = new EventEmitter<SDKEvents>()

    expect(emitter.emit('ready')).toBe(false)
  })

  it('returns true when listeners exist', () => {
    const emitter = new EventEmitter<SDKEvents>()

    emitter.on('ready', () => {})

    expect(emitter.emit('ready')).toBe(true)
  })

  it('supports multiple listeners in subscription order', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const results: number[] = []

    emitter.on('ready', () => results.push(1))
    emitter.on('ready', () => results.push(2))
    emitter.on('ready', () => results.push(3))

    emitter.emit('ready')

    expect(results).toEqual([1, 2, 3])
  })

  it('supports once listeners', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const listener = vi.fn()

    emitter.once('ready', listener)

    emitter.emit('ready')
    emitter.emit('ready')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('removes once listeners before invocation', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const listener = vi.fn()

    emitter.once('ready', listener)

    listener.mockImplementation(() => {
      emitter.emit('ready')
    })

    emitter.emit('ready')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('returns an unsubscribe function', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const listener = vi.fn()

    const unsubscribe = emitter.on('ready', listener)

    unsubscribe()
    unsubscribe()

    emitter.emit('ready')

    expect(listener).not.toHaveBeenCalled()
  })

  it('removes a listener using off()', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const listener = vi.fn()

    emitter.on('ready', listener)
    emitter.off('ready', listener)

    emitter.emit('ready')

    expect(listener).not.toHaveBeenCalled()
  })

  it('removes listeners for a specific event', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const readyListener = vi.fn()
    const errorListener = vi.fn()

    emitter.on('ready', readyListener)
    emitter.on('error', errorListener)

    emitter.removeAllListeners('ready')

    emitter.emit('ready')
    emitter.emit('error', new Error('test'))

    expect(readyListener).not.toHaveBeenCalled()
    expect(errorListener).toHaveBeenCalledTimes(1)
  })

  it('removes all listeners', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const readyListener = vi.fn()
    const errorListener = vi.fn()

    emitter.on('ready', readyListener)
    emitter.on('error', errorListener)

    emitter.removeAllListeners()

    emitter.emit('ready')
    emitter.emit('error', new Error('test'))

    expect(readyListener).not.toHaveBeenCalled()
    expect(errorListener).not.toHaveBeenCalled()
    expect(emitter.eventNames()).toEqual([])
  })

  it('supports AbortSignal cleanup', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const controller = new AbortController()
    const listener = vi.fn()

    emitter.on('ready', listener, {
      signal: controller.signal
    })

    controller.abort()

    emitter.emit('ready')

    expect(listener).not.toHaveBeenCalled()
    expect(emitter.listenerCount('ready')).toBe(0)
  })

  it('does not subscribe with an already aborted signal', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const controller = new AbortController()
    const listener = vi.fn()

    controller.abort()

    emitter.on('ready', listener, {
      signal: controller.signal
    })

    expect(emitter.listenerCount('ready')).toBe(0)
  })

  it('isolates listener errors', () => {
    const error = new Error('Listener failed')
    const onListenerError = vi.fn()

    const emitter = new EventEmitter<SDKEvents>({
      onListenerError
    })

    const first = vi.fn(() => {
      throw error
    })

    const second = vi.fn()

    emitter.on('ready', first)
    emitter.on('ready', second)

    expect(() => emitter.emit('ready')).not.toThrow()

    expect(first).toHaveBeenCalled()
    expect(second).toHaveBeenCalled()

    expect(onListenerError).toHaveBeenCalledWith({
      event: 'ready',
      listener: first,
      error
    })
  })

  it('isolates errors thrown by the error handler', () => {
    const emitter = new EventEmitter<SDKEvents>({
      onListenerError: () => {
        throw new Error('Error handler failed')
      }
    })

    const first = vi.fn(() => {
      throw new Error('Listener failed')
    })

    const second = vi.fn()

    emitter.on('ready', first)
    emitter.on('ready', second)

    expect(() => emitter.emit('ready')).not.toThrow()
    expect(second).toHaveBeenCalled()
  })

  it('does not invoke removed listeners in the current snapshot', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const second = vi.fn()

    let unsubscribeSecond!: () => void

    // The remover must execute before the listener it removes.
    emitter.on('ready', () => {
      unsubscribeSecond()
    })

    unsubscribeSecond = emitter.on('ready', second)

    emitter.emit('ready')

    expect(second).not.toHaveBeenCalled()
  })

  it('does not invoke newly added listeners in the current emission', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const lateListener = vi.fn()

    emitter.on('ready', () => {
      emitter.on('ready', lateListener)
    })

    emitter.emit('ready')

    expect(lateListener).not.toHaveBeenCalled()

    emitter.emit('ready')

    expect(lateListener).toHaveBeenCalledTimes(1)
  })

  it('reports listener counts', () => {
    const emitter = new EventEmitter<SDKEvents>()

    const unsubscribe = emitter.on('ready', () => {})
    emitter.on('ready', () => {})

    expect(emitter.listenerCount('ready')).toBe(2)

    unsubscribe()

    expect(emitter.listenerCount('ready')).toBe(1)
  })

  it('reports event names', () => {
    const emitter = new EventEmitter<SDKEvents>()

    emitter.on('ready', () => {})
    emitter.on('error', () => {})

    expect(emitter.eventNames()).toEqual(['ready', 'error'])
  })

  it('disposes permanently', () => {
    const emitter = new EventEmitter<SDKEvents>()
    const listener = vi.fn()

    emitter.on('ready', listener)

    emitter.dispose()
    emitter.dispose()

    emitter.emit('ready')
    emitter.on('ready', listener)

    expect(listener).not.toHaveBeenCalled()
    expect(emitter.listenerCount('ready')).toBe(0)
    expect(emitter.isDisposed).toBe(true)
  })

  it('does not leak listeners when a once listener throws', () => {
    const emitter = new EventEmitter<SDKEvents>({
      onListenerError: () => {}
    })

    emitter.once('ready', () => {
      throw new Error('failure')
    })

    emitter.emit('ready')

    expect(emitter.listenerCount('ready')).toBe(0)
  })
})
