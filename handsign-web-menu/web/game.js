// Jutsu Challenge game logic. No camera/model code in here, only "confirmed sign" events.
(function (root) {
  // Same order as setting/labels.csv. Index = class_id + 1 (index 0 = "None").
  const LABELS = [
    ['None', '無'], ['Ne (Rat)', '子'], ['Ushi (Ox)', '丑'], ['Tora (Tiger)', '寅'], ['U (Hare)', '卯'],
    ['Tatsu (Dragon)', '辰'], ['Mi (Snake)', '巳'], ['Uma (Horse)', '午'], ['Hitsuji (Ram)', '未'],
    ['Saru (Monkey)', '申'], ['Tori (Bird)', '酉'], ['Inu (Dog)', '戌'], ['I (Boar)', '亥'],
    ['Gassho (Clap)', '祈'], ['Unknown', '謎'], ['Mizunoe', '壬'],
  ];
  const kanjiToId = {};
  LABELS.forEach((l, i) => { kanjiToId[l[1]] = i; });

  // Picked from setting/jutsu.csv (sequences up to 7 signs). Add your own rows here.
  const JUTSU = [
    { name: 'Clone Jutsu',                 signs: '未巳寅' },
    { name: 'Water Trumpet',               signs: '辰寅卯' },
    { name: 'Dragon Flame Jutsu',          signs: '巳辰卯寅' },
    { name: 'Fanged Pursuit Jutsu',        signs: '寅巳辰戌' },
    { name: 'Summoning Jutsu',             signs: '戌亥酉申未' },
    { name: 'Substitution Jutsu',          signs: '未亥丑戌巳' },
    { name: 'Impure World Reincarnation',  signs: '寅巳戌辰祈' },
    { name: 'Fireball Jutsu',              signs: '巳未申亥午寅' },
    { name: 'Phoenix Flower Jutsu',        signs: '子寅戌丑卯寅' },
    { name: 'Dragon Flame Bomb',           signs: '未午巳辰子丑寅' },
  ].map(j => ({ name: j.name, ids: [...j.signs].map(k => kanjiToId[k]) }));

  class Game {
    constructor(opts) {
      this.duration = (opts && opts.duration) || 90;   // seconds
      this.state = 'idle';                              // idle | playing | over
      this.onChange = () => {};
    }
    start() {
      this.score = 0; this.done = 0; this.progress = 0;
      this.timeLeft = this.duration; this.t0 = performance.now();
      this.deck = shuffle(JUTSU.slice());
      this.current = this.deck.pop();
      this.flash = ''; this.state = 'playing'; this.onChange();
    }
    tick() {
      if (this.state !== 'playing') return;
      this.timeLeft = Math.max(0, this.duration - (performance.now() - this.t0) / 1000);
      if (this.timeLeft <= 0) { this.state = 'over'; this.onChange(); }
    }
    // Call once per *confirmed* sign (already debounced). id = label index.
    onSign(id) {
      if (this.state !== 'playing') return;
      const seq = this.current.ids;
      if (id === seq[this.progress]) {
        this.progress++;
        if (this.progress >= seq.length) {
          this.score += 100 + seq.length * 20; this.done++;
          this.flash = this.current.name + '!';
          if (this.deck.length === 0) this.deck = shuffle(JUTSU.slice());
          this.current = this.deck.pop(); this.progress = 0;
        }
      } else {
        // wrong sign: restart this jutsu (but a correct first sign counts right away)
        this.progress = (id === seq[0]) ? 1 : 0;
      }
      this.onChange();
    }
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // Debounce raw per-frame detections into "confirmed sign" events
  // (same idea as --chattering_check in Ninjutsu_demo.py).
  class SignConfirmer {
    constructor(needFrames, releaseMs) {
      this.need = needFrames; this.releaseMs = releaseMs;
      this.cand = -1; this.count = 0; this.last = -1; this.lastSeen = 0;
    }
    // id = label index of the best detection this frame, or -1 for none. Returns id when newly confirmed, else -1.
    update(id, now) {
      if (id < 0) {
        if (now - this.lastSeen > this.releaseMs) this.last = -1;
        this.cand = -1; this.count = 0; return -1;
      }
      this.lastSeen = now;
      if (id === this.cand) this.count++; else { this.cand = id; this.count = 1; }
      if (this.count >= this.need && id !== this.last) { this.last = id; return id; }
      return -1;
    }
  }

  root.GameLogic = { LABELS, JUTSU, Game, SignConfirmer };
})(window);
