/*
 * ECMAScript 2025 準拠のシンプルなテトリス実装
 * - クラス/プライベートフィールド、オプショナルチェーン等の最新構文を使用
 * - SRS風の回転キック、7バッグ乱数、ホールド、ハード/ソフトドロップ
 * - スコア/レベル/ライン数、ポーズ、リセット
 */

/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('tetris');
const ctx = canvas.getContext('2d');
const holdCanvas = /** @type {HTMLCanvasElement} */(document.getElementById('hold'));
const nextCanvas = /** @type {HTMLCanvasElement} */(document.getElementById('next'));
const holdCtx = holdCanvas?.getContext?.('2d') ?? null;
const nextCtx = nextCanvas?.getContext?.('2d') ?? null;

// ボードサイズ
const COLS = 10;
const ROWS = 20;

// キー設定
const KEY = Object.freeze({
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  DOWN: 'ArrowDown',
  ROT_CW: 'ArrowUp',
  ROT_CCW: 'z',
  HARD: ' ',
  HOLD1: 'Shift',
  HOLD2: 'c',
  PAUSE: 'p',
  RESET: 'r',
});

// 入力状態（DAS/ARR用）
const INPUT = { left:false, right:false, down:false };
const DAS = 150; // ms
const ARR = 40;  // ms

// テトロミノ定義（S, Z, L, J, T, O, I）
const TETROS = /** @type {const} */ ({
  S: [
    [0,1,1],
    [1,1,0],
    [0,0,0],
  ],
  Z: [
    [1,1,0],
    [0,1,1],
    [0,0,0],
  ],
  L: [
    [1,0,0],
    [1,1,1],
    [0,0,0],
  ],
  J: [
    [0,0,1],
    [1,1,1],
    [0,0,0],
  ],
  T: [
    [0,1,0],
    [1,1,1],
    [0,0,0],
  ],
  O: [
    [1,1],
    [1,1],
  ],
  I: [
    [0,0,0,0],
    [1,1,1,1],
    [0,0,0,0],
    [0,0,0,0],
  ],
});

const COLORS = {
  S: '#4CC367',
  Z: '#E44D61',
  L: '#F2A33C',
  J: '#4E6CE7',
  T: '#A855F7',
  O: '#E6D34A',
  I: '#2CC6D8',
};

// SRS キック（簡易）
const KICKS = {
  // 通常ブロック（O以外、Iは別定義）
  default: {
    '0>1': [[0,0],[ -1,0],[ -1, 1],[0,-2],[ -1,-2]],
    '1>0': [[0,0],[  1,0],[  1,-1],[0, 2],[  1, 2]],
    '1>2': [[0,0],[  1,0],[  1,-1],[0, 2],[  1, 2]],
    '2>1': [[0,0],[ -1,0],[ -1, 1],[0,-2],[ -1,-2]],
    '2>3': [[0,0],[  1,0],[  1, 1],[0,-2],[  1,-2]],
    '3>2': [[0,0],[ -1,0],[ -1,-1],[0, 2],[ -1, 2]],
    '3>0': [[0,0],[ -1,0],[ -1,-1],[0, 2],[ -1, 2]],
    '0>3': [[0,0],[  1,0],[  1, 1],[0,-2],[  1,-2]],
  },
  // Iミノ
  I: {
    '0>1': [[0,0],[ -2,0],[ 1,0],[ -2,-1],[ 1, 2]],
    '1>0': [[0,0],[  2,0],[ -1,0],[ 2, 1],[ -1,-2]],
    '1>2': [[0,0],[ -1,0],[ 2,0],[ -1, 2],[ 2,-1]],
    '2>1': [[0,0],[  1,0],[ -2,0],[ 1,-2],[ -2, 1]],
    '2>3': [[0,0],[  2,0],[ -1,0],[ 2, 1],[ -1,-2]],
    '3>2': [[0,0],[ -2,0],[ 1,0],[ -2,-1],[ 1, 2]],
    '3>0': [[0,0],[  1,0],[ -2,0],[ 1,-2],[ -2, 1]],
    '0>3': [[0,0],[ -1,0],[ 2,0],[ -1, 2],[ 2,-1]],
  },
};

// 7バッグ乱数
class Bag {
  #pool = [];
  next() {
    if (this.#pool.length === 0) {
      this.#pool = ['S','Z','L','J','T','O','I'];
      // Fisher-Yates
      for (let i = this.#pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.#pool[i], this.#pool[j]] = [this.#pool[j], this.#pool[i]];
      }
    }
    return this.#pool.pop();
  }
}

class Piece {
  type; matrix; x = 3; y = 0; rot = 0; locked = false;
  constructor(type) {
    this.type = type;
    this.matrix = structuredClone(TETROS[type]);
    // I は初期x補正
    if (type === 'I') this.x = 3;
  }
}

class Board {
  width = COLS; height = ROWS; grid = Array.from({length: ROWS}, () => Array(COLS).fill(0));
  clearLines() {
    let cleared = 0;
    for (let y = this.height - 1; y >= 0; y--) {
      if (this.grid[y].every(v => v)) {
        this.grid.splice(y, 1);
        this.grid.unshift(Array(this.width).fill(0));
        cleared++;
        y++;
      }
    }
    return cleared;
  }
  collision(piece, offX = 0, offY = 0, mat = piece.matrix) {
    for (let y = 0; y < mat.length; y++) {
      for (let x = 0; x < mat[y].length; x++) {
        if (!mat[y][x]) continue;
        const nx = piece.x + x + offX;
        const ny = piece.y + y + offY;
        if (nx < 0 || nx >= this.width || ny >= this.height) return true;
        if (ny >= 0 && this.grid[ny]?.[nx]) return true;
      }
    }
    return false;
  }
  merge(piece) {
    piece.locked = true;
    piece.matrix.forEach((row, y) => row.forEach((v, x) => {
      if (v && piece.y + y >= 0) this.grid[piece.y + y][piece.x + x] = piece.type;
    }));
  }
}

class Game {
  board = new Board();
  bag = new Bag();
  current = new Piece(this.bag.next());
  nextQ = [new Piece(this.bag.next()), new Piece(this.bag.next())];
  hold = null; canHold = true;
  score = 0; lines = 0; level = 1;
  dropInterval = 1000; // ms
  elapsed = 0; paused = false; over = false;
  // ロック遅延関連
  lockDelay = 500; // ms の猶予
  lockTimer = 0; // 経過
  grounded = false; // 接地しているか
  // エフェクト
  clearedRows = []; // 直近で消えた行のY
  flashMs = 0; // フラッシュ残時間
  // シェイク
  shake = 0; // 0..1 程度
  // 横移動のリピート
  dasTimer = 0; arrTimer = 0; lastDir = 0; // -1 or 1

  constructor() {
    this.spawnIfNeeded();
    this.updateHUD();
  }

  spawnIfNeeded() {
    if (!this.current || this.current.locked) {
      this.current = this.nextQ.shift();
      this.current.x = 3; this.current.y = -this.current.matrix.length + 1; this.current.rot = 0; this.current.locked = false;
      this.nextQ.push(new Piece(this.bag.next()));
      this.canHold = true;
      this.lockTimer = 0; this.grounded = false;
      if (this.board.collision(this.current, 0, 0)) {
        this.over = true; this.paused = true;
      }
    }
  }

  setLevelByLines() {
    this.level = Math.max(1, Math.floor(this.lines / 10) + 1);
    // 簡易スピードカーブ
    this.dropInterval = Math.max(80, 1000 - (this.level - 1) * 70);
  }

  rotate(dir) {
    if (this.current.type === 'O') return; // Oは回転不要
    const from = this.current.rot;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;
    const rotated = rotateMatrix(this.current.matrix, dir);
    const key = `${from}>${to}`;
    const table = (this.current.type === 'I' ? KICKS.I : KICKS.default)[key] || [[0,0]];
    for (const [dx, dy] of table) {
      if (!this.board.collision(this.current, dx, dy, rotated)) {
        this.current.matrix = rotated;
        this.current.x += dx; this.current.y += dy; this.current.rot = to;
        // 回転で接地を外れたらロックタイマーをリセット
        if (!this.board.collision(this.current, 0, 1)) { this.grounded = false; this.lockTimer = 0; }
        return true;
      }
    }
    return false;
  }

  move(dx) {
    if (!this.board.collision(this.current, dx, 0)) {
      this.current.x += dx;
      // 横移動で接地を外れたらロックタイマーをリセット
      if (!this.board.collision(this.current, 0, 1)) { this.grounded = false; this.lockTimer = 0; }
    }
  }

  softDrop() {
    if (!this.board.collision(this.current, 0, 1)) {
      this.current.y++;
      this.score += 1;
      this.updateHUD('score');
      this.grounded = false; this.lockTimer = 0;
      return true;
    } else {
      // 接地。ロック遅延を適用
      this.grounded = true;
      return false;
    }
  }

  hardDrop() {
    let dist = 0;
    while (!this.board.collision(this.current, 0, 1)) { this.current.y++; dist++; }
    this.score += dist * 2;
    this.lockDown();
  }

  holdPiece() {
    if (!this.canHold) return;
    this.canHold = false;
    const temp = this.hold;
    this.hold = new Piece(this.current.type);
    if (temp) {
      this.current = new Piece(temp.type);
    } else {
      this.current = this.nextQ.shift();
      this.nextQ.push(new Piece(this.bag.next()));
    }
    this.current.x = 3; this.current.y = -this.current.matrix.length + 1; this.current.rot = 0; this.current.locked = false;
    if (this.board.collision(this.current, 0, 0)) { this.over = true; this.paused = true; }
    this.lockTimer = 0; this.grounded = false;
    this.updateHUD();
  }

  lockDown() {
    this.board.merge(this.current);
    const cleared = this.board.clearLines();
    if (cleared) {
      const base = [0, 100, 300, 500, 800][cleared] ?? 0;
      this.score += base * this.level;
      this.lines += cleared;
      this.setLevelByLines();
      // エフェクト設定
      this.clearedRows = []; // 現在の盤面の空行側からは取得不可のため、消去直前に取るのが理想だが簡易に全行を対象外としフラッシュのみ
      this.flashMs = 220; // 220ms フラッシュ
      this.shake = Math.min(0.6, 0.25 + cleared * 0.12);
      this.updateHUD();
    }
    else {
      // 通常着地も軽くシェイク
      this.shake = Math.max(this.shake, 0.18);
    }
    this.current.locked = true;
    this.spawnIfNeeded();
    this.lockTimer = 0; this.grounded = false;
  }

  update(delta) {
    if (this.paused || this.over) return;
    this.elapsed += delta;
    // フラッシュ減衰
    if (this.flashMs > 0) this.flashMs = Math.max(0, this.flashMs - delta);
    // シェイク減衰
    if (this.shake > 0) this.shake = Math.max(0, this.shake - delta * 0.0035);

    // 自然落下
    if (this.elapsed >= this.dropInterval) {
      this.elapsed = 0;
      if (!this.softDrop()) {
        // 接地している
        this.grounded = true;
      }
    }

    // 横移動のDAS/ARR
    const dir = (INPUT.left ? -1 : 0) + (INPUT.right ? 1 : 0);
    if (dir !== 0) {
      if (this.lastDir !== dir) {
        // 方向が変わった/押し始め
        this.lastDir = dir;
        this.dasTimer = 0; this.arrTimer = 0;
        this.move(dir);
      } else {
        this.dasTimer += delta;
        if (this.dasTimer >= DAS) {
          this.arrTimer += delta;
          while (this.arrTimer >= ARR) {
            this.move(dir);
            this.arrTimer -= ARR;
          }
        }
      }
    } else {
      this.lastDir = 0; this.dasTimer = 0; this.arrTimer = 0;
    }

    // ロック遅延処理
    if (this.grounded) {
      this.lockTimer += delta;
      // 途中で上方向に浮けるなら解除
      if (!this.board.collision(this.current, 0, 1)) {
        this.grounded = false; this.lockTimer = 0;
      } else if (this.lockTimer >= this.lockDelay) {
        this.lockTimer = 0; this.grounded = false; this.lockDown();
      }
    }
  }

  drawCell(x, y, type) {
    ctx.fillStyle = COLORS[type] ?? '#ccc';
    ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = 'rgba(0,0,0,.15)';
    ctx.lineWidth = 0.05;
    ctx.strokeRect(x + 0.02, y + 0.02, 0.96, 0.96);
  }

  ghostY() {
    const piece = this.current;
    let gy = piece.y;
    while (!this.board.collision(piece, 0, (gy - piece.y) + 1)) gy++;
    return gy;
  }

  render() {
    // 背景
    ctx.save();
    // シェイクを適用
    const sx = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake : 0;
    ctx.translate(sx, sy);
    // キャンバス実寸から動的スケール
    const BLOCK = Math.floor(Math.min(canvas.width / COLS, canvas.height / ROWS));
    ctx.scale(BLOCK, BLOCK);
    ctx.clearRect(0, 0, COLS, ROWS);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, COLS, ROWS);

    // 盤面
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = this.board.grid[y][x];
        if (t) this.drawCell(x, y, t);
      }
    }

    // ゴースト
    const gy = this.ghostY();
    ctx.globalAlpha = 0.25;
    this.current.matrix.forEach((row, y) => row.forEach((v, x) => {
      if (v) this.drawCell(this.current.x + x, gy + y, this.current.type);
    }));
    ctx.globalAlpha = 1;

    // 現在ピース
    this.current.matrix.forEach((row, y) => row.forEach((v, x) => {
      if (v && this.current.y + y >= 0) this.drawCell(this.current.x + x, this.current.y + y, this.current.type);
    }));

    // ライン消去フラッシュ
    if (this.flashMs > 0) {
      const a = this.flashMs / 220;
      ctx.fillStyle = `rgba(255,255,255,${(0.35 * a).toFixed(3)})`;
      ctx.fillRect(0, 0, COLS, ROWS);
    }

    // ゲームオーバー表示
    if (this.over) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 6, COLS, 8);
      ctx.fillStyle = '#fff';
      ctx.font = '1.2px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', COLS/2, ROWS/2);
      ctx.font = '0.6px system-ui, sans-serif';
      ctx.fillText('R でリセット', COLS/2, ROWS/2 + 1.2);
    } else if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 7, COLS, 6);
      ctx.fillStyle = '#fff';
      ctx.font = '1.2px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', COLS/2, ROWS/2);
    }

    ctx.restore();

    // プレビュー描画
    this.renderPreviews();
  }

  updateHUD(which) {
    if (!which || which === 'score') document.getElementById('score').textContent = `${this.score}`;
    if (!which || which === 'level') document.getElementById('level').textContent = `${this.level}`;
    if (!which || which === 'lines') document.getElementById('lines').textContent = `${this.lines}`;
  }
}

// 行列回転（dir: 1=時計回り, -1=反時計）
function rotateMatrix(m, dir) {
  const N = m.length;
  const res = Array.from({length: N}, () => Array(m[0].length).fill(0));
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m[y].length; x++) {
      if (dir > 0) {
        res[x][m.length - 1 - y] = m[y][x];
      } else {
        res[m[0].length - 1 - x][y] = m[y][x];
      }
    }
  }
  return res;
}

// 入力処理（DAS/ARRは簡略）
const game = new Game();
let last = performance.now();

function loop(t) {
  const delta = t - last; last = t;
  game.update(delta);
  game.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.repeat) {
    // 連打は必要部分のみ許容
    if (e.key === KEY.DOWN) { e.preventDefault(); game.softDrop(); }
    return;
  }
  keys.add(e.key);
  switch (e.key) {
    case KEY.LEFT: e.preventDefault(); /* 初回移動はDASロジックに委譲 */ break;
    case KEY.RIGHT: e.preventDefault(); /* 初回移動はDASロジックに委譲 */ break;
    case KEY.DOWN: e.preventDefault(); game.softDrop(); break;
    case KEY.ROT_CW: e.preventDefault(); game.rotate(1); break;
    case KEY.ROT_CCW: e.preventDefault(); game.rotate(-1); break;
    case KEY.HARD: e.preventDefault(); game.hardDrop(); break;
    case KEY.HOLD1:
    case KEY.HOLD2: e.preventDefault(); game.holdPiece(); break;
    case KEY.PAUSE: game.paused = !game.paused; break;
    case KEY.RESET: Object.assign(game, new Game()); break;
  }
  if (e.key === KEY.LEFT) { INPUT.left = true; }
  if (e.key === KEY.RIGHT) { INPUT.right = true; }
  if (e.key === KEY.DOWN) { INPUT.down = true; }
});

addEventListener('keyup', (e) => {
  keys.delete(e.key);
  if (e.key === KEY.LEFT) { INPUT.left = false; }
  if (e.key === KEY.RIGHT) { INPUT.right = false; }
  if (e.key === KEY.DOWN) { INPUT.down = false; }
});

// ===== プレビュー描画 =====
function drawMini(ctxp, matrix, color, cell, offsetX = 0, offsetY = 0) {
  if (!ctxp) return;
  ctxp.save();
  ctxp.clearRect(0, 0, ctxp.canvas.width, ctxp.canvas.height);
  // バウンディング
  const rows = matrix.length, cols = matrix[0].length;
  let minX = cols, maxX = -1, minY = rows, maxY = -1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (matrix[y][x]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // セルサイズを自動計算（余白を少し確保）
  const availW = ctxp.canvas.width - 8;
  const availH = ctxp.canvas.height - 8;
  const cellsW = (maxX - minX + 1) || 1;
  const cellsH = (maxY - minY + 1) || 1;
  cell = cell ?? Math.floor(Math.min(availW / cellsW, availH / cellsH));
  const w = cellsW * cell;
  const h = cellsH * cell;
  const ox = Math.floor((ctxp.canvas.width - w)/2) + offsetX;
  const oy = Math.floor((ctxp.canvas.height - h)/2) + offsetY;
  ctxp.fillStyle = color;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (matrix[y][x]) {
    const px = ox + (x - minX) * cell;
    const py = oy + (y - minY) * cell;
    ctxp.fillRect(px, py, cell, cell);
    ctxp.strokeStyle = 'rgba(0,0,0,.2)';
    ctxp.strokeRect(px + 1, py + 1, cell - 2, cell - 2);
  }
  ctxp.restore();
}

Game.prototype.renderPreviews = function() {
  // Hold
  if (holdCtx) {
    if (this.hold) drawMini(holdCtx, this.hold.matrix, COLORS[this.hold.type]);
    else { holdCtx.clearRect(0, 0, holdCtx.canvas.width, holdCtx.canvas.height); }
  }
  // Next（最大2個）
  if (nextCtx) {
    nextCtx.clearRect(0, 0, nextCtx.canvas.width, nextCtx.canvas.height);
    const spacing = 10;
    this.nextQ.slice(0,2).forEach((p, i) => {
      const tmp = structuredClone(p.matrix);
      // tmpを上から順に2つ描画
      // セルサイズは各ピースに合わせつつ、縦方向は段間スペースを考慮
      // まず自動セルサイズで一度描画領域サイズを出す
      // drawMiniを使うため、計算をここで行い、描画は手動で行う
      // バウンディング
      const rows = tmp.length, cols = tmp[0].length;
      let minX = cols, maxX = -1, minY = rows, maxY = -1;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (tmp[y][x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const cellsW = (maxX - minX + 1) || 1;
      const cellsH = (maxY - minY + 1) || 1;
      const availW = nextCtx.canvas.width - 8;
      const availHEach = Math.floor((nextCtx.canvas.height - spacing - 8) / 2);
      const cell = Math.floor(Math.min(availW / cellsW, availHEach / cellsH));
      const w = cellsW * cell;
      const h = cellsH * cell;
      const ox = Math.floor((nextCtx.canvas.width - w)/2);
      const oy = 6 + i * (availHEach + spacing) + Math.floor((availHEach - h)/2);
      nextCtx.fillStyle = COLORS[p.type];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (tmp[y][x]) {
        const px = ox + (x - minX) * cell;
        const py = oy + (y - minY) * cell;
        nextCtx.fillRect(px, py, cell, cell);
        nextCtx.strokeStyle = 'rgba(0,0,0,.2)';
        nextCtx.strokeRect(px + 1, py + 1, cell - 2, cell - 2);
      }
    });
  }
}

