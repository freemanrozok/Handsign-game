// Browser port of model/yolox/yolox_onnx.py (preprocess + decode + class-agnostic NMS).
// Works in the browser (global `Detect`) and in Node (module.exports) for testing.
(function (root) {
  const STRIDES = [8, 16, 32];

  // Letterbox ratio exactly like Python: min(S/h, S/w); image is placed top-left, padded with 114.
  function letterboxRatio(w, h, size) {
    return Math.min(size / h, size / w);
  }

  // RGBA pixels (from canvas) -> Float32 CHW in BGR order, values 0..255 (no normalisation).
  function rgbaToBgrChw(px, size, out) {
    const n = size * size;
    out = out || new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      out[i] = px[p + 2];         // B
      out[n + i] = px[p + 1];     // G
      out[2 * n + i] = px[p];     // R
    }
    return out;
  }

  const gridCache = {};
  function getGrids(size) {
    if (gridCache[size]) return gridCache[size];
    const gx = [], gy = [], st = [];
    for (const s of STRIDES) {
      const hs = Math.floor(size / s), ws = Math.floor(size / s);
      for (let y = 0; y < hs; y++) for (let x = 0; x < ws; x++) { gx.push(x); gy.push(y); st.push(s); }
    }
    return (gridCache[size] = { gx, gy, st, n: gx.length });
  }

  function nms(x1, y1, x2, y2, scores, thr) {
    const n = scores.length;
    const areas = new Float64Array(n);
    for (let i = 0; i < n; i++) areas[i] = (x2[i] - x1[i] + 1) * (y2[i] - y1[i] + 1);
    let order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const keep = [];
    while (order.length > 0) {
      const i = order[0];
      keep.push(i);
      const rest = [];
      for (let k = 1; k < order.length; k++) {
        const j = order[k];
        const w = Math.max(0, Math.min(x2[i], x2[j]) - Math.max(x1[i], x1[j]) + 1);
        const h = Math.max(0, Math.min(y2[i], y2[j]) - Math.max(y1[i], y1[j]) + 1);
        const inter = w * h;
        const ovr = inter / (areas[i] + areas[j] - inter);
        if (ovr <= thr) rest.push(j);
      }
      order = rest;
    }
    return keep;
  }

  // data: Float32Array [numAnchors * cols] (cols = 5 + numClasses). Returns [{x1,y1,x2,y2,score,classId}]
  function decode(data, cols, size, ratio, nmsTh, nmsScoreTh, maxW, maxH) {
    const g = getGrids(size);
    const nc = cols - 5;
    const bx1 = [], by1 = [], bx2 = [], by2 = [], sc = [], cid = [];
    for (let a = 0; a < g.n; a++) {
      const o = a * cols;
      // best class (class-agnostic): argmax of obj * cls
      let best = 0, bestScore = -1;
      const obj = data[o + 4];
      for (let c = 0; c < nc; c++) {
        const s = obj * data[o + 5 + c];
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (!(bestScore > nmsScoreTh)) continue;
      const cx = (data[o] + g.gx[a]) * g.st[a];
      const cy = (data[o + 1] + g.gy[a]) * g.st[a];
      const w = Math.exp(data[o + 2]) * g.st[a];
      const h = Math.exp(data[o + 3]) * g.st[a];
      bx1.push((cx - w / 2) / ratio); by1.push((cy - h / 2) / ratio);
      bx2.push((cx + w / 2) / ratio); by2.push((cy + h / 2) / ratio);
      sc.push(bestScore); cid.push(best);
    }
    if (sc.length === 0) return [];
    const keep = nms(bx1, by1, bx2, by2, sc, nmsTh);
    return keep.map(i => ({
      x1: Math.max(0, bx1[i]), y1: Math.max(0, by1[i]),
      x2: Math.min(bx2[i], maxW), y2: Math.min(by2[i], maxH),
      score: sc[i], classId: cid[i],
    }));
  }

  const api = { letterboxRatio, rgbaToBgrChw, decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Detect = api;
})(typeof window !== 'undefined' ? window : globalThis);
