// The spectrum bars the old pages draw (audio.js Lab.drawSpectrum): log-spaced bands from 35 Hz to 16 kHz.
import { audio } from './context'

export function drawSpectrum(cv: HTMLCanvasElement | null, an: AnalyserNode, spec: Float32Array<ArrayBuffer>, live: boolean) {
  if (!cv) return
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight
  if (!w) return
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
  const g = cv.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
  const n = Math.max(24, Math.floor(w / 7)), bw = w / n - 2, bin = audio().sampleRate / an.fftSize, fmin = 35, fmax = 16000
  if (live) an.getFloatFrequencyData(spec)
  const grad = g.createLinearGradient(0, h, 0, 0)
  grad.addColorStop(0, '#8b7bff'); grad.addColorStop(1, '#5bd6ff')
  g.fillStyle = grad
  for (let i = 0; i < n; i++) {
    let v = 0
    if (live) {
      const b0 = Math.floor(fmin * Math.pow(fmax / fmin, i / n) / bin), b1 = Math.max(b0 + 1, Math.floor(fmin * Math.pow(fmax / fmin, (i + 1) / n) / bin))
      let db = -200; for (let b = b0; b < b1; b++) if (spec[b] > db) db = spec[b]
      v = Math.min(1, Math.max(0, (db + 92) / 66))
    }
    const bh = Math.max(2, v * (h - 2)), x = i * (w / n) + 1
    g.globalAlpha = live ? 0.35 + 0.65 * v : 0.25
    g.beginPath(); g.roundRect(x, h - bh, bw, bh, 1.5); g.fill()
  }
  g.globalAlpha = 1
}
