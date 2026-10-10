/** Polls until `predicate(lastFrame())` holds; fails with the last frame so the cause is visible. */
export async function until(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 4000,
): Promise<string> {
  const start = Date.now()
  for (;;) {
    const frame = lastFrame() ?? ''
    if (predicate(frame)) return frame
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for the screen. Last frame:\n${frame}`)
    }
    await new Promise((r) => setTimeout(r, 10))
  }
}

export const has = (text: string) => (frame: string) => frame.includes(text)
export const lacks = (text: string) => (frame: string) => !frame.includes(text)

/**
 * Ink subscribes input handlers in an effect, so a key sent in the instant a screen appears can be
 * dropped. Tests settle briefly after observing a change before sending the next key.
 */
export const settle = (ms = 70) => new Promise((r) => setTimeout(r, ms))
