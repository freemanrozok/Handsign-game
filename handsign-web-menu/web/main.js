const CFG = { size: 416, scoreTh: 0.7, nmsTh: 0.45, nmsScoreTh: 0.1, confirmFrames: 3, releaseMs: 1200 };
const { LABELS, Game, SignConfirmer } = GameLogic;

const $ = id => document.getElementById(id);
const cam = $('cam'), canvas = $('view'), ctx = canvas.getContext('2d');
const tmp = document.createElement('canvas'); tmp.width = tmp.height = CFG.size;
const tctx = tmp.getContext('2d', { willReadFrequently: true });
const chw = new Float32Array(3 * CFG.size * CFG.size);

let ortSession, inputName, outputName, modelPromise = null;
const game = new Game({ duration: 90 });
const confirmer = new SignConfirmer(CFG.confirmFrames, CFG.releaseMs);
let lastSignText = '-', fps = 0, running = false, runId = 0, busy = false, lastT = performance.now();

const sleep = ms => new Promise(r => setTimeout(r, ms));
function show(name) { ['menu', 'game', 'bye'].forEach(s => { $(s).hidden = s !== name; }); }

// ---------- model (loads in the background while the menu is showing) ----------
function loadModel() {
  if (!modelPromise) {
    modelPromise = ort.InferenceSession.create('model/yolox_nano.onnx', { executionProviders: ['wasm'] })
      .then(s => { ortSession = s; inputName = s.inputNames[0]; outputName = s.outputNames[0]; })
      .catch(e => { modelPromise = null; throw e; });
  }
  return modelPromise;
}

// ---------- camera (only started after pressing Start) ----------
async function startCamera() {
  cam.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 540, facingMode: 'user' }, audio: false });
  await cam.play();
  canvas.width = cam.videoWidth; canvas.height = cam.videoHeight;
}
function stopCamera() {
  if (cam.srcObject) cam.srcObject.getTracks().forEach(t => t.stop());
  cam.srcObject = null;
}
function camError(e) {
  if (e.name === 'NotAllowedError') return 'Camera blocked. Allow it in the address bar, then press Start again.';
  if (e.name === 'NotFoundError') return 'No camera found.';
  return 'Error: ' + e.message;
}

// ---------- flow: menu -> start -> countdown -> play -> over ----------
async function startGame() {
  const id = ++runId;
  $('startBtn').disabled = $('quitBtn').disabled = true;
  $('menuMsg').textContent = 'Starting camera…';
  try { await loadModel(); await startCamera(); }
  catch (e) {
    stopCamera();
    $('menuMsg').textContent = camError(e);
    $('startBtn').disabled = $('quitBtn').disabled = false;
    return;
  }
  $('menuMsg').textContent = '';
  $('quitBtn').disabled = false;
  lastSignText = '-';
  show('game'); running = true;
  requestAnimationFrame(() => loop(id));
  beginRound(id);
}

async function beginRound(id) {
  game.state = 'idle';
  $('count').hidden = false;
  for (let n = 3; n > 0; n--) { $('count').textContent = n; await sleep(1000); if (id !== runId) return; }
  $('count').hidden = true;
  confirmer.last = -1;
  game.start();
}

function goMenu() {
  runId++; running = false; game.state = 'idle';
  stopCamera();
  $('count').hidden = true;
  $('startBtn').disabled = $('quitBtn').disabled = false;
  $('menuMsg').textContent = '';
  show('menu');
}

function quitGame() {
  runId++; running = false; game.state = 'idle';
  stopCamera();
  show('bye');
  window.close(); // only works if the tab was opened by a script; otherwise the Thanks screen stays
}

// ---------- detection + loop ----------
async function detect() {
  const vw = cam.videoWidth, vh = cam.videoHeight, S = CFG.size;
  if (!vw) return [];
  const ratio = Detect.letterboxRatio(vw, vh, S);
  tctx.fillStyle = 'rgb(114,114,114)'; tctx.fillRect(0, 0, S, S);
  tctx.drawImage(cam, 0, 0, vw, vh, 0, 0, Math.trunc(vw * ratio), Math.trunc(vh * ratio));
  Detect.rgbaToBgrChw(tctx.getImageData(0, 0, S, S).data, S, chw);
  const out = await ortSession.run({ [inputName]: new ort.Tensor('float32', chw, [1, 3, S, S]) });
  const t = out[outputName];
  const dets = Detect.decode(t.data, t.dims[2], S, ratio, CFG.nmsTh, CFG.nmsScoreTh, vw, vh);
  return dets.filter(d => d.score >= CFG.scoreTh && d.classId + 1 < LABELS.length)
             .sort((a, b) => b.score - a.score);
}

async function loop(id) {
  if (id !== runId || !running) return;
  if (!busy) {
    busy = true;
    try {
      const dets = await detect();
      if (id !== runId || !running) { busy = false; return; }
      ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
      for (const d of dets) {
        ctx.strokeStyle = '#3f3'; ctx.lineWidth = 3;
        ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
        ctx.fillStyle = '#3f3'; ctx.font = '20px sans-serif';
        const L = LABELS[d.classId + 1];
        ctx.fillText(`${L[1]} ${L[0]} ${d.score.toFixed(2)}`, d.x1, Math.max(20, d.y1 - 6));
      }
      const best = dets.length ? dets[0].classId + 1 : -1;
      if (best >= 0) lastSignText = LABELS[best][1] + ' ' + LABELS[best][0];
      const confirmed = confirmer.update(best, performance.now());
      if (confirmed >= 0) game.onSign(confirmed);
      const now = performance.now(); fps = 0.9 * fps + 0.1 * (1000 / (now - lastT)); lastT = now;
    } catch (e) { $('fps').textContent = 'Error: ' + e.message; console.error(e); }
    busy = false;
  } else if (cam.videoWidth) {
    ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
  }
  game.tick(); render();
  requestAnimationFrame(() => loop(id));
}

function render() {
  $('fps').textContent = fps.toFixed(1) + ' FPS · last sign: ' + lastSignText;
  $('score').textContent = game.score || 0;
  $('time').textContent = game.state === 'playing' ? Math.ceil(game.timeLeft) : (game.state === 'over' ? 0 : '-');
  $('over').hidden = game.state !== 'over';
  const box = $('target');
  if (game.state === 'playing') {
    $('jname').textContent = game.current.name;
    box.innerHTML = game.current.ids.map((id, i) =>
      `<div class="chip ${i < game.progress ? 'done' : (i === game.progress ? 'next' : '')}"><b>${LABELS[id][1]}</b><span>${LABELS[id][0]}</span></div>`).join('');
    $('msg').textContent = game.flash;
  } else if (game.state === 'over') {
    $('jname').textContent = 'Time up!';
    box.innerHTML = '';
    $('overText').textContent = `Jutsu completed: ${game.done} · Score: ${game.score}`;
  } else {
    $('jname').textContent = 'Get ready…'; box.innerHTML = ''; $('msg').textContent = '';
  }
}

// ---------- buttons ----------
$('startBtn').onclick = startGame;
$('quitBtn').onclick = quitGame;
$('menuBtn').onclick = goMenu;
$('overMenuBtn').onclick = goMenu;
$('backBtn').onclick = goMenu;
$('againBtn').onclick = () => beginRound(runId);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('game').hidden) goMenu(); });

loadModel()
  .then(() => { $('startBtn').disabled = false; $('menuMsg').textContent = 'Ready!'; })
  .catch(e => { $('startBtn').disabled = false; $('menuMsg').textContent = 'Could not load the model: ' + e.message; console.error(e); });

// ---------- menu selection (mouse hover + Up/Down + Enter) ----------
const menuItems = [$('startBtn'), $('quitBtn')]; let sel = 0;
function setSel(i) { sel = i; menuItems.forEach((b, j) => b.classList.toggle('sel', j === i)); }
menuItems.forEach((b, i) => b.addEventListener('mouseenter', () => setSel(i)));
setSel(0);
document.addEventListener('keydown', e => {
  if ($('menu').hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setSel((sel + (e.key === 'ArrowDown' ? 1 : 1) + 2) % 2); e.preventDefault(); }
  else if (e.key === 'Enter') { menuItems[sel].click(); e.preventDefault(); }
});
