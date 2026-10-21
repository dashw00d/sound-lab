// A spectrogram, off the main thread: a mono signal into an RGBA image (time across, log frequency up, magma colours).
// 2048-point FFT, Hann window; rows log-spaced from 40 Hz to 16 kHz; level in dB against the loudest, over 70 dB.
const FFT = 2048
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}
// magma, as stops (t, r, g, b)
const STOPS = [[0, 4, 4, 14], [0.15, 30, 17, 70], [0.3, 81, 18, 124], [0.45, 130, 37, 129], [0.6, 183, 55, 121], [0.72, 228, 81, 100], [0.84, 251, 135, 97], [0.93, 254, 194, 135], [1, 252, 253, 191]]
const LUT = new Uint8ClampedArray(256 * 3)
for (let i = 0; i < 256; i++) {
  const t = i / 255, k = STOPS.findIndex(s => s[0] >= t), b = STOPS[Math.max(1, k)], a = STOPS[Math.max(0, k - 1)], f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0])
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f
}
self.onmessage = (e: MessageEvent<{ id: number; x: Float32Array; sr: number; width: number; height: number }>) => {
  const { id, x, sr, width, height } = e.data
  const hop = Math.max(1, Math.floor((x.length - FFT) / width)), win = new Float32Array(FFT)
  for (let i = 0; i < FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT)
  const lo = Math.log(40), hi = Math.log(Math.min(16000, sr / 2)), rows = new Int32Array(height + 1)
  for (let r = 0; r <= height; r++) rows[r] = Math.min(FFT / 2 - 1, Math.max(1, Math.round((Math.exp(lo + ((hi - lo) * r) / height) * FFT) / sr)))
  const db = new Float32Array(width * height), re = new Float32Array(FFT), im = new Float32Array(FFT)
  let top = -Infinity
  for (let c = 0; c < width; c++) {
    const at = c * hop
    for (let i = 0; i < FFT; i++) { re[i] = (x[at + i] ?? 0) * win[i]; im[i] = 0 }
    fft(re, im)
    for (let r = 0; r < height; r++) {
      let s = 0, n = 0
      for (let k = rows[r]; k <= Math.max(rows[r], rows[r + 1] - 1); k++) { s += re[k] * re[k] + im[k] * im[k]; n++ }
      const v = 10 * Math.log10(s / n + 1e-12)
      db[c * height + r] = v
      if (v > top) top = v
    }
  }
  const img = new Uint8ClampedArray(width * height * 4)
  for (let c = 0; c < width; c++) for (let r = 0; r < height; r++) {
    const v = Math.max(0, Math.min(255, Math.round(((db[c * height + r] - top + 70) / 70) * 255))), p = ((height - 1 - r) * width + c) * 4
    img[p] = LUT[v * 3]; img[p + 1] = LUT[v * 3 + 1]; img[p + 2] = LUT[v * 3 + 2]; img[p + 3] = 255
  }
  ;(self as unknown as Worker).postMessage({ id, img, width, height }, [img.buffer])
}
