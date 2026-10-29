const sounds = ['error', 'warning', 'success', 'notification'] as const

/** Decode once, then start a fresh buffer source on arrival, as in Meu Carrinho. */
export class NotificationAudio {
  private files = new Map<string, Promise<ArrayBuffer>>()
  private buffers = new Map<string, Promise<AudioBuffer>>()
  private voices = new Map<AudioBufferSourceNode, GainNode>()
  private activated = false
  private version = 0
  private abort = new AbortController()

  constructor(private getContext: () => AudioContext) {}

  private buffer(sound: string, context: AudioContext) {
    let decoded = this.buffers.get(sound)
    if (!decoded) {
      let file = this.files.get(sound)
      if (!file) {
        file = fetch(`/sounds/notifications/${sound}.wav`, { signal: this.abort.signal })
          .then(response => { if (!response.ok) throw new Error(`Audio HTTP ${response.status}`); return response.arrayBuffer() })
        this.files.set(sound, file)
      }
      decoded = file.then(bytes => context.decodeAudioData(bytes.slice(0)))
      this.buffers.set(sound, decoded)
      void decoded.catch(() => { if (this.buffers.get(sound) === decoded) { this.files.delete(sound); this.buffers.delete(sound) } })
    }
    return decoded
  }

  unlock() {
    this.activated = true
    try {
      const context = this.getContext()
      if (context.state !== 'running') void context.resume().catch(() => undefined)
      for (const sound of sounds) void this.buffer(sound, context).catch(() => undefined)
    } catch { /* Another trusted interaction can retry without replaying old alerts. */ }
  }

  stop() {
    this.version++
    for (const [source, gain] of this.voices) {
      gain.gain.value = 0
      try { source.stop() } catch { /* The short source may have already ended. */ }
      source.disconnect(); gain.disconnect()
    }
    this.voices.clear()
  }

  async play(sound: string, volume: number, eligible: () => boolean): Promise<boolean> {
    if (!this.activated || !sounds.includes(sound as typeof sounds[number]) || volume <= 0 || !eligible()) return false
    this.stop()
    const version = this.version
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const context = this.getContext()
      const ready = await Promise.race([
        Promise.all([context.state === 'running' ? Promise.resolve() : context.resume(), this.buffer(sound, context)]),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500) }),
      ])
      if (!ready || version !== this.version || !eligible() || context.state !== 'running') return false
      const source = context.createBufferSource(), gain = context.createGain()
      source.buffer = ready[1]
      gain.gain.value = Math.max(0, Math.min(1, volume))
      source.connect(gain); gain.connect(context.destination)
      source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect() }
      this.voices.set(source, gain)
      source.start(0)
      return true
    } catch (error) {
      console.warn('[Pulse] Notification audio could not start', error)
      return false
    } finally { clearTimeout(timer) }
  }

  dispose() {
    this.activated = false
    this.stop(); this.abort.abort(); this.files.clear(); this.buffers.clear()
  }
}
