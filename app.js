'use strict';

/* =========================================================
   健康トラッカー（プロトタイプ）
   - 記録はこの端末のブラウザ（localStorage）に保存する
   - 1日1件の記録を { "YYYY-MM-DD": 記録 } の形で持つ
   - 栄養素の定義・成分表の検索・計算は nutrients.js にある
   - 体重・運動の消費カロリー・基礎代謝の計算は body.js にある
   ========================================================= */

const STORAGE_KEY = 'health-tracker:v1';
const INTENSITY = [{ v: 1, label: '軽い' }, { v: 2, label: '普通' }, { v: 3, label: 'きつい' }];
const MEAL_KINDS = ['朝食', '昼食', '夕食', '間食'];
const CONDITION_ROWS = [
  { key: 'fatigueWork', group: '疲労度', label: '仕事' },
  { key: 'fatiguePrivate', group: '疲労度', label: 'プライベート' },
  { key: 'stressWork', group: 'ストレス', label: '仕事' },
  { key: 'stressPrivate', group: 'ストレス', label: 'プライベート' },
];
const VIEWS = ['today', 'week', 'foods', 'config'];

// アプリ全体の状態
const state = {
  data: null,        // 保存されている全データ { records, settings, myFoods }
  draft: null,       // 今画面で編集中の1日分の記録
  dirty: false,      // 未保存の変更があるか
  view: 'today',     // 表示中の画面
  search: null,      // 食材検索中の場所 { i: 食事, j: 料理, k: 差し替える食材 or null, query }
  returnTo: null,    // マイ食品の登録後に戻る場所（検索から登録へ進んだとき）
  nutriOpen: false,  // 「すべての栄養素」を開いているか
  mfBasis: '100g',   // マイ食品フォームの基準
  mfEditId: null,    // 編集中のマイ食品
  mfDeleteAsk: null, // 削除確認中のマイ食品
};

const $ = (sel) => document.querySelector(sel);

/* ---------- 日付・時刻のユーティリティ ---------- */

function pad(n) { return String(n).padStart(2, '0'); }

// Date を "2026-10-26" の形にする（端末の現地時刻で）
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function todayStr() { return toDateStr(new Date()); }

// "2026-10-26" に n 日足した日付を返す
function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}

// "2026-10-26" を "10月26日（月）" にする
function formatDateJa(str) {
  const [y, m, d] = str.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日（${w}）`;
}

// 現在時刻を "2026-10-26T21:00:00+09:00" の形にする
function nowIsoWithOffset() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function nowTime() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

/* ---------- 計算 ---------- */

// "23:30" を 0時からの分数にする
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 就寝〜起床の分数。就寝が起床より遅い時刻なら日付をまたいだとみなす
function sleepMinutes(sleep) {
  const bed = timeToMin(sleep.bedtime);
  const wake = timeToMin(sleep.wakeTime);
  if (bed === null || wake === null) return null;
  let diff = wake - bed;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

// 分数を "7時間15分" の形にする
function formatDuration(min) {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

function exerciseTotal(rec) { return rec.exercise.reduce((sum, e) => sum + (e.minutes || 0), 0); }

function average(nums) {
  const list = nums.filter((n) => typeof n === 'number');
  if (list.length === 0) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

// 料理1品の栄養合計
function dishNutrients(dish) { return sumNutrients(dish.ingredients.map((g) => g.nutrients)); }

// 1日の栄養合計（すべての食事・料理・食材）
function dayNutrients(rec) {
  return sumNutrients(rec.meals.flatMap((m) => m.items.flatMap((it) => it.ingredients.map((g) => g.nutrients))));
}

function hasNutrients(n) { return Object.keys(n).length > 0; }

function kcalText(n) { return `${Math.round(n.kcal || 0).toLocaleString()} kcal`; }

function fmtKcal(v) { return Math.round(v).toLocaleString(); }

function shortDate(str) { const [, m, d] = str.split('-').map(Number); return `${m}/${d}`; }

// 日付ごとの体重 { "2026-10-26": 68.4 }。編集中の日は画面の値を使う
function weightMap() {
  const map = {};
  Object.keys(state.data.records).forEach((d) => {
    const b = state.data.records[d].body;
    if (b && b.weightKg != null) map[d] = b.weightKg;
  });
  if (state.draft) {
    const w = state.draft.body.weightKg;
    if (w != null) map[state.draft.date] = w; else delete map[state.draft.date];
  }
  return map;
}

// その日の体重。記録がなければ、それより前で一番新しい体重を使う
function weightFor(date) {
  const map = weightMap();
  const d = Object.keys(map).filter((k) => k <= date).sort().pop();
  return d ? map[d] : null;
}

// その日より前で一番新しい体重
function previousWeight(date) {
  const map = weightMap();
  const d = Object.keys(map).filter((k) => k < date).sort().pop();
  return d ? { date: d, weightKg: map[d] } : null;
}

// 1日の運動：消費カロリーの合計と、収支に足す「上乗せ分」
function exerciseStats(rec) {
  const w = weightFor(rec.date);
  const mets = state.data.settings.mets;
  let gross = 0;
  let extra = 0;
  let any = false;
  rec.exercise.forEach((e) => {
    const m = metsFor(mets, e.type, e.intensity);
    const k = exerciseKcal(m, w, e.minutes);
    if (k != null) { gross += k; any = true; }
    extra += exerciseExtraKcal(m, w, e.minutes);
  });
  return { weightKg: w, gross: any ? gross : null, extra };
}

// 1日のカロリー収支
// 消費 = 基礎代謝 × 普段の活動量 ＋ 運動の上乗せ分　／　収支 = 摂取 − 消費
function dayBalance(rec) {
  const p = state.data.settings.profile;
  const n = dayNutrients(rec);
  const ex = exerciseStats(rec);
  const out = { intake: hasNutrients(n) ? (n.kcal || 0) : null, exercise: ex.gross, missing: null };
  if (!profileComplete(p)) { out.missing = 'profile'; return out; }
  if (!ex.weightKg) { out.missing = 'weight'; return out; }
  out.bmr = basalMetabolism({ weightKg: ex.weightKg, heightCm: p.heightCm, age: ageAt(p.birthMonth, rec.date), sex: p.sex });
  out.base = out.bmr * p.activityLevel;
  out.extra = ex.extra;
  out.burn = out.base + ex.extra;
  out.balance = out.intake == null ? null : out.intake - out.burn;
  return out;
}

/* ---------- データの形 ---------- */

// 何も入力していない1日分の記録
function emptyRecord(date) {
  return {
    date,
    body: { weightKg: null },
    exercise: [],
    steps: null,
    meals: [],
    sleep: { bedtime: '', wakeTime: '', napMinutes: null },
    waterMl: 0,
    condition: { fatigueWork: null, fatiguePrivate: null, stressWork: null, stressPrivate: null, memo: '' },
    updatedAt: null,
  };
}

function emptyIngredient() {
  return { foodId: null, name: '', foodName: '', grams: null, servings: null, nutrients: null };
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// 食材を最新の形にそろえる（以前の「文字だけの食材」も読めるようにする）
function normalizeIngredient(g) {
  if (typeof g === 'string') return { ...emptyIngredient(), name: g };
  return { ...emptyIngredient(), ...g };
}

// 保存済みの記録に足りない項目があっても動くように、空の記録と合成する
function normalize(rec) {
  const base = emptyRecord(rec.date);
  const r = clone(rec);
  return {
    ...base,
    ...r,
    sleep: { ...base.sleep, ...(r.sleep || {}) },
    body: { ...base.body, ...(r.body || {}) },
    condition: { ...base.condition, ...(r.condition || {}) },
    exercise: r.exercise || [],
    meals: (r.meals || []).map((m) => ({
      ...m,
      items: (m.items || []).map((it) => ({
        name: '', amount: '', ...it,
        ingredients: (it.ingredients || []).map(normalizeIngredient),
      })),
    })),
  };
}

// 保存用に、中身が空の行を取り除いたコピーを作る（編集中の draft はそのまま）
function cleanRecord(rec) {
  const r = clone(rec);
  r.exercise = r.exercise.filter((e) => e.type || e.minutes);
  r.meals.forEach((m) => {
    m.items.forEach((it) => { it.ingredients = it.ingredients.filter((g) => g.name || g.foodId); });
    m.items = m.items.filter((it) => it.name || it.amount || it.ingredients.length);
  });
  r.meals = r.meals.filter((m) => m.items.length > 0);
  r.meals.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  return r;
}

function isEmptyRecord(r) {
  const c = r.condition;
  return r.exercise.length === 0 && r.steps == null && r.meals.length === 0
    && !r.sleep.bedtime && !r.sleep.wakeTime && r.sleep.napMinutes == null
    && !r.waterMl
    && c.fatigueWork == null && c.fatiguePrivate == null && c.stressWork == null && c.stressPrivate == null
    && !c.memo
    && r.body.weightKg == null;
}

/* ---------- 保存と読み込み ---------- */

// ブラウザに保存する。プライベートブラウズなどで失敗したら false
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    return true;
  } catch (e) {
    return false;
  }
}

// 設定の初期値と、保存済みの設定を合わせる
function mergeSettings(s) {
  const src = s || {};
  const mets = { ...clone(DEFAULT_METS), ...(src.mets || {}) };
  // METs の初期値が更新されていたら、初期の運動は新しい値にそろえる（自分で追加した運動はそのまま）
  if (src.metsVersion !== METS_VERSION) {
    Object.keys(DEFAULT_METS).forEach((k) => { mets[k] = [...DEFAULT_METS[k]]; });
  }
  return {
    cupMl: src.cupMl || 200,
    profile: { ...DEFAULT_PROFILE, ...(src.profile || {}) },
    mets,
    metsVersion: METS_VERSION,
  };
}

// 保存済みデータを読み込む。初回はサンプルを入れる
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { records: d.records || {}, settings: mergeSettings(d.settings), myFoods: d.myFoods || [] };
    }
  } catch (e) { /* 読めなければ新規として扱う */ }
  const d = { records: {}, settings: mergeSettings(null), myFoods: [] };
  addSamples(d);
  return d;
}

// 編集中の記録を保存する
function saveDraft() {
  const r = cleanRecord(state.draft);
  // 運動の METs と消費カロリーも記録に残す（あとで分析するときに使う）
  const w = weightFor(r.date);
  r.exercise.forEach((e) => {
    e.mets = metsFor(state.data.settings.mets, e.type, e.intensity);
    e.kcal = exerciseKcal(e.mets, w, e.minutes);
  });
  if (isEmptyRecord(r)) {
    delete state.data.records[r.date];
  } else {
    delete r.sample; // 自分で保存した日はサンプル扱いを外す
    delete state.draft.sample;
    r.updatedAt = nowIsoWithOffset();
    state.draft.updatedAt = r.updatedAt;
    state.data.records[r.date] = r;
  }
  const ok = persist();
  state.dirty = false;
  updateSaveStatus(ok ? 'saved' : 'error');
  if (ok) showToast('保存しました');
  return ok;
}

// 未保存の変更があれば保存する（日付や画面を切り替える前に呼ぶ）
function saveIfDirty() { if (state.dirty) saveDraft(); }

/* ---------- サンプルデータ ---------- */

// 食材のサンプル。q は成分表の呼び名（成分表を読み込んだあとで栄養を計算する）
const ing = (q, grams) => ({ ...emptyIngredient(), name: q, q, grams });

// 初回に過去5日分のサンプルを入れる（3日前は「未記録」の例としてあえて空ける）
function addSamples(d) {
  const S = [
    {
      exercise: [{ type: 'ウォーキング', minutes: 35, intensity: 1 }], steps: 8420,
      meals: [
        { time: '07:20', kind: '朝食', items: [{ name: 'ご飯', amount: '茶碗1杯', ingredients: [ing('ご飯（白米）', 150)] }, { name: '味噌汁', amount: '', ingredients: [ing('みそ（淡色辛みそ）', 12), ing('絹ごし豆腐', 30), ing('長ねぎ', 10)] }] },
        { time: '12:30', kind: '昼食', items: [{ name: '親子丼', amount: '1人前', ingredients: [ing('鶏もも肉（皮つき）', 80), ing('たまねぎ', 50), ing('卵（全卵・生）', 50), ing('ご飯（白米）', 200), ing('しょうゆ（濃口）', 10), ing('みりん', 10)] }] },
        { time: '19:40', kind: '夕食', items: [{ name: '焼き鮭', amount: '1切れ', ingredients: [ing('鮭', 80)] }, { name: 'サラダ', amount: '小鉢', ingredients: [ing('レタス', 30), ing('トマト', 50), ing('きゅうり', 30)] }] },
      ],
      sleep: { bedtime: '23:40', wakeTime: '06:50', napMinutes: null }, waterMl: 1400,
      condition: { fatigueWork: 3, fatiguePrivate: 2, stressWork: 3, stressPrivate: 1, memo: '' },
    },
    {
      exercise: [{ type: '筋トレ', minutes: 25, intensity: 3 }, { type: 'ストレッチ', minutes: 10, intensity: 1 }], steps: 5310,
      meals: [
        { time: '08:00', kind: '朝食', items: [{ name: 'トースト', amount: '1枚', ingredients: [ing('食パン', 60), ing('バター', 8)] }, { name: 'ヨーグルト', amount: '', ingredients: [ing('ヨーグルト（無糖）', 100)] }] },
        { time: '13:10', kind: '昼食', items: [{ name: 'かけそば', amount: '', ingredients: [ing('そば（ゆで）', 200), ing('長ねぎ', 10)] }] },
      ],
      sleep: { bedtime: '00:30', wakeTime: '07:00', napMinutes: 20 }, waterMl: 1000,
      condition: { fatigueWork: 4, fatiguePrivate: 2, stressWork: 4, stressPrivate: 2, memo: '会議が多かった' },
    },
    null,
    {
      exercise: [], steps: 3900,
      meals: [{ time: '21:30', kind: '夕食', items: [{ name: 'コンビニ弁当', amount: '', ingredients: [] }] }],
      sleep: { bedtime: '01:10', wakeTime: '06:40', napMinutes: null }, waterMl: 600,
      condition: { fatigueWork: 5, fatiguePrivate: 3, stressWork: 4, stressPrivate: 3, memo: '締切前' },
    },
    {
      exercise: [{ type: 'ランニング', minutes: 30, intensity: 2 }], steps: 11200,
      meals: [
        { time: '09:00', kind: '朝食', items: [{ name: 'おにぎり', amount: '2個', ingredients: [ing('ご飯（白米）', 200)] }] },
        { time: '15:00', kind: '間食', items: [{ name: 'バナナ', amount: '1本', ingredients: [ing('バナナ', 100)] }] },
        { time: '19:00', kind: '夕食', items: [{ name: 'カレー', amount: '大盛り', ingredients: [ing('豚もも（豚こま）', 80), ing('じゃがいも', 80), ing('にんじん', 40), ing('たまねぎ', 80), ing('サラダ油', 6), ing('ご飯（白米）', 300)] }] },
      ],
      sleep: { bedtime: '23:10', wakeTime: '07:10', napMinutes: 30 }, waterMl: 1800,
      condition: { fatigueWork: 2, fatiguePrivate: 1, stressWork: 2, stressPrivate: 1, memo: '休日' },
    },
  ];
  const today = todayStr();
  S.forEach((s, i) => {
    if (!s) return;
    const date = addDays(today, -(i + 1));
    const weight = [72.4, 72.6, null, 72.9, 73.1][i];
    d.records[date] = { ...emptyRecord(date), ...clone(s), body: { weightKg: weight }, date, sample: true, updatedAt: null };
  });
}

// 成分表を読み込んだあと、サンプルの食材に栄養を計算して入れる
function resolveSampleIngredients() {
  let changed = false;
  Object.values(state.data.records).forEach((r) => {
    if (!r.sample) return;
    (r.meals || []).forEach((m) => m.items.forEach((it) => (it.ingredients || []).forEach((g) => {
      if (!g.q || g.foodId) return;
      const alias = FoodDB.aliases.find((a) => a.label === g.q);
      if (!alias) return;
      g.foodId = alias.id;
      g.foodName = displayFoodName(FoodDB.foods.get(alias.id).name);
      g.nutrients = calcIngredient(foodNutrition(alias.id, []), g.grams, null);
      delete g.q;
      changed = true;
    })));
  });
  if (changed) persist();
  return changed;
}

function hasSamples() { return Object.values(state.data.records).some((r) => r.sample); }

/* ---------- 画面：今日の記録 ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 表示する日付を切り替える
function setDate(date) {
  saveIfDirty();
  const saved = state.data.records[date];
  state.draft = saved ? normalize(saved) : emptyRecord(date);
  state.dirty = false;
  state.search = null;
  renderToday();
  updateSaveStatus(saved ? 'loaded' : 'new');
}

function renderToday() {
  const r = state.draft;
  const today = todayStr();
  $('#day-label').textContent = formatDateJa(r.date);
  $('#go-today').hidden = r.date === today;
  $('#next-day').disabled = r.date >= today;

  $('#weight').value = r.body.weightKg ?? '';
  updateWeight();
  renderExercise();
  $('#steps').value = r.steps ?? '';
  renderMeals();
  $('#bedtime').value = r.sleep.bedtime || '';
  $('#wake-time').value = r.sleep.wakeTime || '';
  $('#nap').value = r.sleep.napMinutes ?? '';
  updateSleepSummary();
  $('#water-ml').value = r.waterMl || '';
  updateWater();
  renderCondition();
  $('#cond-memo').value = r.condition.memo || '';
  updateBalance();
  renderSampleBanner();
}

// 体重カード：BMI と前回との差
function updateWeight() {
  const w = state.draft.body.weightKg;
  const p = state.data.settings.profile;
  const prev = previousWeight(state.draft.date);
  const bmi = calcBmi(w, p.heightCm);
  $('#weight-summary').textContent = bmi ? `BMI ${bmi.toFixed(1)}（${bmiLabel(bmi)}）` : '';
  let text = '';
  if (w != null && prev) text = `前回（${shortDate(prev.date)}）から ${signed(w - prev.weightKg, 1)} kg`;
  else if (w == null && prev) text = `前回（${shortDate(prev.date)}）は ${prev.weightKg.toFixed(1)} kg`;
  if (w != null && !p.heightCm) text += `${text ? '。' : ''}設定で身長を入れるとBMIを表示します`;
  $('#weight-diff').textContent = text;
}

// カロリー収支カード
function updateBalance() {
  const b = dayBalance(state.draft);
  const el = $('#balance');
  if (b.missing === 'profile') {
    el.innerHTML = '<p class="empty">設定の「プロフィール」で身長・生年月・性別を入れると、消費カロリーと収支を計算します。</p><button type="button" class="add-btn" data-view="config">プロフィールを入れる</button>';
    return;
  }
  if (b.missing === 'weight') {
    el.innerHTML = '<p class="empty">体重を一度記録すると、消費カロリーと収支を計算します。</p>';
    return;
  }
  const bal = b.balance;
  const tone = bal == null ? '' : bal <= 0 ? 'minus' : 'plus';
  el.innerHTML = `
    <div class="bal-grid">
      <div class="bal-cell"><span>摂取</span><b>${b.intake == null ? '—' : fmtKcal(b.intake)}</b><small>kcal</small></div>
      <div class="bal-cell"><span>消費</span><b>${fmtKcal(b.burn)}</b><small>kcal</small></div>
      <div class="bal-cell result ${tone}"><span>収支</span><b>${bal == null ? '—' : signed(bal)}</b><small>kcal</small></div>
    </div>
    <p class="bal-detail">消費の内訳：基礎代謝 ${fmtKcal(b.bmr)} × 普段の活動量 ${state.data.settings.profile.activityLevel.toFixed(2)} ＝ ${fmtKcal(b.base)}　＋　運動の上乗せ分 ${fmtKcal(b.extra)}</p>
    ${b.intake == null ? '<p class="bal-detail">食事に食材とグラム数を入れると、摂取カロリーと収支が出ます。</p>' : ''}
    ${bal != null ? `<p class="bal-detail">${bal <= 0 ? '消費が摂取を上回っています。' : '摂取が消費を上回っています。'}</p>` : ''}`;
}

// これまでに使った運動の種類（新しい順）＋ 初期候補
function exerciseTypes() {
  const used = [];
  Object.keys(state.data.records).sort().reverse().forEach((date) => {
    (state.data.records[date].exercise || []).forEach((e) => { if (e.type && !used.includes(e.type)) used.push(e.type); });
  });
  Object.keys(state.data.settings.mets).forEach((t) => { if (!used.includes(t)) used.push(t); });
  return used.slice(0, 12);
}

function renderExercise() {
  const list = state.draft.exercise;
  $('#exercise-list').innerHTML = list.length === 0
    ? '<p class="empty">まだ運動の記録はありません。下の候補か「＋ 運動を追加」から入力できます。</p>'
    : list.map((e, i) => `
      <div class="ex-row">
        <input type="text" list="ex-types" placeholder="運動の種類" value="${esc(e.type)}" data-path="exercise.${i}.type" aria-label="運動の種類">
        <span class="num"><input type="number" inputmode="numeric" min="0" placeholder="0" value="${e.minutes ?? ''}" data-path="exercise.${i}.minutes" data-type="int" aria-label="運動時間（分）"><span>分</span></span>
        <button type="button" class="icon-btn" data-action="remove-exercise" data-index="${i}" aria-label="この運動を削除">×</button>
        <div class="seg" role="group" aria-label="強度">
          ${INTENSITY.map((x) => `<button type="button" class="${e.intensity === x.v ? 'on' : ''}" aria-pressed="${e.intensity === x.v}" data-action="set-intensity" data-index="${i}" data-val="${x.v}">${x.label}</button>`).join('')}
        </div>
        <span class="ex-kcal" id="exkcal-${i}"></span>
        <span class="ex-desc" id="exdesc-${i}"></span>
      </div>`).join('');

  const types = exerciseTypes();
  $('#ex-types').innerHTML = types.map((t) => `<option value="${esc(t)}"></option>`).join('');
  $('#exercise-chips').innerHTML = types.map((t) => `<button type="button" class="chip" data-action="add-exercise" data-type="${esc(t)}">${esc(t)}</button>`).join('');
  updateExerciseKcals();
}

// 運動1件ごとの消費カロリーと、カードの合計を更新する
function updateExerciseKcals() {
  const w = weightFor(state.draft.date);
  state.draft.exercise.forEach((e, i) => {
    const el = $(`#exkcal-${i}`);
    if (!el) return;
    const m = metsFor(state.data.settings.mets, e.type, e.intensity);
    const k = exerciseKcal(m, w, e.minutes);
    el.textContent = k != null ? `${k} kcal（${m} METs）` : `${m} METs`;
    const desc = metsDescription(state.data.settings.mets, e.type, e.intensity);
    $(`#exdesc-${i}`).textContent = desc ? `${INTENSITY[(e.intensity || 2) - 1].label}：${desc}` : '';
  });
  $('#ex-note').hidden = !(state.draft.exercise.length && !w);
  const total = exerciseTotal(state.draft);
  const st = exerciseStats(state.draft);
  const parts = [];
  if (total) parts.push(`${total}分`);
  if (st.gross) parts.push(`${st.gross.toLocaleString()} kcal`);
  $('#ex-summary').textContent = parts.join(' ・ ');
}

/* ----- 食事 ----- */

// 食材1行の、量の入力欄（g か、1食・1個単位）
function amountInput(g, base) {
  const nut = g.foodId ? foodNutrition(g.foodId, state.data.myFoods) : null;
  if (nut && nut.basis === 'serving' && !nut.servingGrams) {
    return `<span class="num"><input type="number" inputmode="decimal" min="0" step="0.5" placeholder="1" value="${g.servings ?? ''}" data-path="${base}.servings" data-type="num" aria-label="数量"><span>${esc(nut.servingLabel)}</span></span>`;
  }
  return `<span class="num"><input type="number" inputmode="decimal" min="0" placeholder="0" value="${g.grams ?? ''}" data-path="${base}.grams" data-type="num" aria-label="グラム数"><span>g</span></span>`;
}

function ingredientRow(g, i, j, k) {
  const base = `meals.${i}.items.${j}.ingredients.${k}`;
  let sub = g.foodName || '';
  if (!g.foodId) sub = '成分表と未連携・タップして選ぶ';
  else if (String(g.foodId).startsWith('my:')) sub = 'マイ食品';
  return `
    <div class="ing-row">
      <button type="button" class="ing-name" data-action="edit-ingredient" data-i="${i}" data-j="${j}" data-k="${k}">
        <span>${esc(g.name || '（未選択）')}</span><small class="${g.foodId ? '' : 'warn'}">${esc(sub)}</small>
      </button>
      ${amountInput(g, base)}
      <span class="ing-kcal" id="kcal-${i}-${j}-${k}">${g.nutrients ? kcalText(g.nutrients) : '—'}</span>
      <button type="button" class="icon-btn" data-action="remove-ingredient" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="この食材を削除">×</button>
    </div>`;
}

// 料理の合計を1行で
function dishTotalText(dish) {
  const n = dishNutrients(dish);
  if (!hasNutrients(n)) return '';
  return `料理の合計　${kcalText(n)}　／　${MAIN_NUTRIENTS.slice(1).map((x) => `${x.label} ${formatNutrient(x, n[x.key])}${x.unit}`).join('　')}`;
}

function searchBox(i, j) {
  const s = state.search;
  if (!s || s.i !== i || s.j !== j) return '';
  return `
    <div class="food-search">
      <input type="search" id="food-search-input" autocomplete="off" placeholder="食材名で検索（例：鶏もも、たまねぎ）" value="${esc(s.query)}" aria-label="食材を検索">
      <ul class="food-results" id="food-results"></ul>
      <div class="search-foot">
        <button type="button" class="text-btn" data-action="search-myfood">マイ食品として登録する</button>
        <button type="button" class="text-btn muted" data-action="close-search">閉じる</button>
      </div>
    </div>`;
}

function renderMeals() {
  const meals = state.draft.meals;
  $('#meal-list').innerHTML = meals.length === 0
    ? '<p class="empty">まだ食事の記録はありません。</p>'
    : meals.map((m, i) => `
      <div class="meal">
        <div class="meal-head">
          <input type="time" value="${esc(m.time)}" data-path="meals.${i}.time" aria-label="食事の時刻">
          <select data-path="meals.${i}.kind" aria-label="食事の区分">
            ${MEAL_KINDS.map((k) => `<option ${k === m.kind ? 'selected' : ''}>${k}</option>`).join('')}
          </select>
          <button type="button" class="icon-btn" data-action="remove-meal" data-index="${i}" aria-label="この食事を削除">×</button>
        </div>
        ${m.items.map((it, j) => `
          <div class="dish">
            <div class="dish-top">
              <input type="text" placeholder="料理名" value="${esc(it.name)}" data-path="meals.${i}.items.${j}.name" aria-label="料理名">
              <input type="text" placeholder="量（任意）" value="${esc(it.amount)}" data-path="meals.${i}.items.${j}.amount" aria-label="量">
              <button type="button" class="icon-btn" data-action="remove-item" data-index="${i}" data-item="${j}" aria-label="この料理を削除">×</button>
            </div>
            <div class="ing-list">${it.ingredients.map((g, k) => ingredientRow(g, i, j, k)).join('')}</div>
            ${searchBox(i, j)}
            <button type="button" class="text-btn" data-action="add-ingredient" data-i="${i}" data-j="${j}">＋ 食材</button>
            <p class="dish-total" id="dishtotal-${i}-${j}">${dishTotalText(it)}</p>
          </div>`).join('')}
        <button type="button" class="text-btn" data-action="add-item" data-index="${i}">＋ 料理を追加</button>
      </div>`).join('');
  if (state.search) renderSearchResults();
  updateMealSummary();
  renderNutritionPanel();
}

function updateMealSummary() {
  const meals = state.draft.meals;
  const n = dayNutrients(state.draft);
  const parts = [];
  if (meals.length) parts.push(`${meals.length}回`);
  if (hasNutrients(n)) parts.push(kcalText(n));
  $('#meal-summary').textContent = parts.join(' ・ ');
  updateBalance();
}

// 1日の栄養（主な6つ＋すべての栄養素）
function renderNutritionPanel() {
  const r = state.draft;
  const n = dayNutrients(r);
  const unlinked = r.meals.flatMap((m) => m.items.flatMap((it) => it.ingredients)).filter((g) => g.name && !g.nutrients).length;
  const panel = $('#nutrition-panel');
  if (!hasNutrients(n)) {
    panel.innerHTML = '<p class="empty">料理に食材とグラム数を入れると、この日の栄養がここに計算されます。</p>';
    return;
  }
  const groupTable = (g) => `
    <div class="nutri-group">
      <h4>${g.label}</h4>
      <dl>${NUTRIENTS.filter((x) => x.group === g.id).map((x) => `<div><dt>${x.label}</dt><dd>${formatNutrient(x, n[x.key])}<small>${x.unit}</small></dd></div>`).join('')}</dl>
    </div>`;
  panel.innerHTML = `
    <h3>この日の栄養</h3>
    <div class="nutri-main">
      ${MAIN_NUTRIENTS.map((x) => `<div class="nutri-tile"><span>${x.label}</span><b>${formatNutrient(x, n[x.key])}<small>${x.unit}</small></b></div>`).join('')}
    </div>
    <details id="nutri-details" ${state.nutriOpen ? 'open' : ''}>
      <summary>すべての栄養素を見る（${NUTRIENTS.length - MAIN_NUTRIENTS.length}項目）</summary>
      ${NUTRIENT_GROUPS.filter((g) => g.id !== 'main').map(groupTable).join('')}
    </details>
    <p class="note">${unlinked ? `量が未入力か成分表と未連携の食材が${unlinked}件あり、計算に含まれていません。` : ''}成分表で未測定の成分は0として合計しています。</p>`;
  $('#nutri-details').addEventListener('toggle', (e) => { state.nutriOpen = e.target.open; });
}

// 最近使った食材（成分表の食品のみ。新しい順）
function recentFoods() {
  const out = [];
  const seen = new Set();
  Object.keys(state.data.records).sort().reverse().forEach((date) => {
    (state.data.records[date].meals || []).forEach((m) => (m.items || []).forEach((it) => (it.ingredients || []).forEach((g) => {
      if (!g.foodId || String(g.foodId).startsWith('my:') || seen.has(g.foodId)) return;
      seen.add(g.foodId);
      out.push({ id: g.foodId, label: g.name });
    })));
  });
  return out.slice(0, 10);
}

function renderSearchResults() {
  const ul = $('#food-results');
  if (!ul) return;
  const q = state.search.query;
  if (FoodDB.status === 'loading') { ul.innerHTML = '<li class="msg">成分表を読み込んでいます…</li>'; return; }
  const results = searchFoods(q, recentFoods(), state.data.myFoods);
  let html = results.map((r) => `
    <li><button type="button" data-action="pick-food" data-ref="${esc(r.ref)}" data-label="${esc(r.label)}">
      <span class="r-name">${esc(r.label)}</span>
      <span class="r-sub">${esc(r.sub)}</span>
      <span class="r-kcal">${r.kcal != null ? `${Math.round(r.kcal)} kcal` : ''}<small>${esc(r.kcalUnit || '')}</small></span>
    </button></li>`).join('');
  if (FoodDB.status === 'error') html = '<li class="msg">成分表を読み込めませんでした。マイ食品は使えます。</li>' + html;
  if (!results.length && q) html += '<li class="msg">見つかりませんでした。ひらがなで探すか、マイ食品として登録してください。</li>';
  if (!results.length && !q) html += '<li class="msg">食材名を入力してください。</li>';
  ul.innerHTML = html;
}

// 検索結果から食材を選んだとき
function pickFood(ref, label, target) {
  const { i, j, k } = target;
  const dish = state.draft.meals[i].items[j];
  const nut = foodNutrition(ref, state.data.myFoods);
  const old = k != null ? dish.ingredients[k] : null;
  const g = { ...emptyIngredient(), foodId: ref, name: label };
  if (String(ref).startsWith('my:')) g.foodName = 'マイ食品';
  else g.foodName = displayFoodName(FoodDB.foods.get(ref).name);
  // 量の初期値：差し替えなら前の量、1食単位のマイ食品なら1食分
  if (nut.basis === 'serving' && !nut.servingGrams) g.servings = old && old.servings != null ? old.servings : 1;
  else if (old && old.grams != null) g.grams = old.grams;
  else if (nut.basis === 'serving' && nut.servingGrams) g.grams = nut.servingGrams;
  g.nutrients = calcIngredient(nut, g.grams, g.servings);

  let index;
  if (k != null) { dish.ingredients[k] = g; index = k; } else { dish.ingredients.push(g); index = dish.ingredients.length - 1; }
  state.search = null;
  markDirty();
  renderMeals();
  const input = document.querySelector(`[data-path="meals.${i}.items.${j}.ingredients.${index}.grams"], [data-path="meals.${i}.items.${j}.ingredients.${index}.servings"]`);
  if (input) { input.focus(); input.select(); }
}

// グラム数が変わった食材の栄養を計算し直して、表示を更新する
function recalcIngredient(i, j, k) {
  const g = state.draft.meals[i].items[j].ingredients[k];
  g.nutrients = g.foodId ? calcIngredient(foodNutrition(g.foodId, state.data.myFoods), g.grams, g.servings) : null;
  $(`#kcal-${i}-${j}-${k}`).textContent = g.nutrients ? kcalText(g.nutrients) : '—';
  $(`#dishtotal-${i}-${j}`).textContent = dishTotalText(state.draft.meals[i].items[j]);
  updateMealSummary();
  renderNutritionPanel();
}

/* ----- 睡眠・水分・疲労度 ----- */

function updateSleepSummary() {
  const s = state.draft.sleep;
  const min = sleepMinutes(s);
  let text = min === null ? '' : formatDuration(min);
  if (s.napMinutes) text += `${text ? ' ＋ ' : ''}昼寝${s.napMinutes}分`;
  $('#sleep-summary').textContent = text;
}

function updateWater() {
  const ml = state.draft.waterMl || 0;
  const cup = state.data.settings.cupMl;
  const cups = Math.round((ml / cup) * 10) / 10;
  $('#water-big').textContent = ml.toLocaleString();
  $('#water-summary').textContent = ml ? `コップ ${cups}杯（1杯${cup}mL）` : '';
}

function renderCondition() {
  const c = state.draft.condition;
  $('#cond-list').innerHTML = CONDITION_ROWS.map((row) => `
    <div class="cond-row">
      <span class="cond-label">${row.group}<small>${row.label}</small></span>
      <div class="scale" role="group" aria-label="${row.group}（${row.label}）">
        ${[1, 2, 3, 4, 5].map((v) => `<button type="button" class="${c[row.key] === v ? 'on' : ''}" aria-pressed="${c[row.key] === v}" data-action="set-cond" data-key="${row.key}" data-val="${v}">${v}</button>`).join('')}
      </div>
    </div>`).join('');
}

function renderSampleBanner() { $('#sample-banner').hidden = !hasSamples(); }

/* ---------- 編集の反映 ---------- */

// "meals.0.items.1.name" のような道筋で draft に値を書き込む
function setByPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
  cur[keys[keys.length - 1]] = value;
}

function readInput(el) {
  if (el.dataset.type === 'int' || el.dataset.type === 'num') {
    if (el.value === '') return null;
    const n = el.dataset.type === 'int' ? parseInt(el.value, 10) : parseFloat(el.value);
    return Number.isNaN(n) || n < 0 ? null : n;
  }
  return el.value;
}

function markDirty() {
  state.dirty = true;
  updateSaveStatus('dirty');
}

// 記録画面の入力欄が変わったとき
function onInput(e) {
  if (e.target.id === 'food-search-input') {
    state.search.query = e.target.value;
    renderSearchResults();
    return;
  }
  const path = e.target.dataset.path;
  if (!path) return;
  let value = readInput(e.target);
  if (path === 'waterMl') value = value || 0;
  setByPath(state.draft, path, value);
  markDirty();
  if (path.startsWith('sleep')) updateSleepSummary();
  if (path === 'waterMl') updateWater();
  if (path.startsWith('exercise')) { updateExerciseKcals(); updateBalance(); }
  if (path === 'body.weightKg') { updateWeight(); updateExerciseKcals(); updateBalance(); }
  const m = path.match(/^meals\.(\d+)\.items\.(\d+)\.ingredients\.(\d+)\.(grams|servings)$/);
  if (m) recalcIngredient(+m[1], +m[2], +m[3]);
}

/* ---------- 画面：直近7日 ---------- */

function renderWeek() {
  const today = todayStr();
  const days = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(today, -k));
  const recs = days.map((d) => (state.data.records[d] ? normalize(state.data.records[d]) : null));
  const filled = recs.filter(Boolean);
  const balances = recs.map((r) => (r ? dayBalance(r) : null));
  const map = weightMap();
  const weights = days.map((d) => (map[d] != null ? map[d] : null));

  const avgSleep = average(filled.map((r) => sleepMinutes(r.sleep)));
  const avgSteps = average(filled.map((r) => r.steps));
  const avgKcal = average(balances.map((b) => (b ? b.intake : null)));
  const balList = balances.map((b) => (b ? b.balance : null)).filter((v) => typeof v === 'number');
  const balSum = balList.length ? balList.reduce((a, b) => a + b, 0) : null;
  // 体重の変化：7日間で一番古い記録と一番新しい記録の差
  const wList = weights.map((w, i) => ({ w, d: days[i] })).filter((x) => x.w != null);
  const wChange = wList.length >= 2 ? wList[0].w - wList[wList.length - 1].w : null;

  $('#week-stats').innerHTML = [
    ['記録した日', `${filled.length} / 7日`, ''],
    ['体重の変化', wChange == null ? '—' : `${signed(wChange, 1)}kg`, wList.length ? `最新 ${wList[0].w.toFixed(1)}kg` : ''],
    ['収支の合計', balSum == null ? '—' : `${signed(balSum)}kcal`, balSum == null ? '' : `体脂肪 約${Math.abs(balSum / KCAL_PER_KG_FAT).toFixed(2)}kg分の${balSum <= 0 ? '減少' : '増加'}（目安・${balList.length}日分）`],
    ['平均摂取', avgKcal === null ? '—' : `${fmtKcal(avgKcal)}kcal`, ''],
    ['平均睡眠', avgSleep === null ? '—' : formatDuration(Math.round(avgSleep)), ''],
    ['平均歩数', avgSteps === null ? '—' : Math.round(avgSteps).toLocaleString(), ''],
  ].map(([label, val, sub]) => `<div class="stat"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`).join('');

  const pair = (a, b) => `${a ?? '–'} / ${b ?? '–'}`;
  $('#week-body').innerHTML = days.map((d, i) => {
    const r = recs[i];
    const label = `${formatDateJa(d)}${d === today ? '<span class="tag">今日</span>' : ''}${r && r.sample ? '<span class="tag">サンプル</span>' : ''}`;
    if (!r) {
      return `<tr class="missing" data-date="${d}" tabindex="0"><td>${label}</td><td class="missing-cell" colspan="10">未記録（タップして入力）</td></tr>`;
    }
    const c = r.condition;
    const b = balances[i];
    const st = exerciseStats(r);
    return `<tr data-date="${d}" tabindex="0">
      <td>${label}</td>
      <td>${weights[i] != null ? weights[i].toFixed(1) : '–'}</td>
      <td>${exerciseTotal(r) ? `${exerciseTotal(r)}分${st.gross ? `<small>${st.gross}kcal</small>` : ''}` : '–'}</td>
      <td>${r.steps != null ? r.steps.toLocaleString() : '–'}</td>
      <td>${formatDuration(sleepMinutes(r.sleep))}</td>
      <td>${r.waterMl ? `${r.waterMl.toLocaleString()}mL` : '–'}</td>
      <td>${pair(c.fatigueWork, c.fatiguePrivate)}</td>
      <td>${pair(c.stressWork, c.stressPrivate)}</td>
      <td>${r.meals.length ? `${r.meals.length}回` : '–'}</td>
      <td>${b.intake != null ? fmtKcal(b.intake) : '–'}</td>
      <td class="${b.balance == null ? '' : b.balance <= 0 ? 'minus' : 'plus'}">${b.balance != null ? signed(b.balance) : '–'}</td>
    </tr>`;
  }).join('');
  renderSampleBanner();
}

/* ---------- 画面：マイ食品 ---------- */

function nutrientInput(n) {
  return `<label class="field" for="mf-v-${n.key}"><span>${n.label}</span>
    <span class="num"><input type="number" id="mf-v-${n.key}" inputmode="decimal" min="0" step="any" data-key="${n.key}"><span>${n.unit}</span></span></label>`;
}

// マイ食品フォームの栄養素の入力欄を作る（最初に1回だけ）
function buildMyFoodForm() {
  $('#mf-main').innerHTML = MAIN_NUTRIENTS.map(nutrientInput).join('');
  $('#mf-more').innerHTML = NUTRIENT_GROUPS.filter((g) => g.id !== 'main').map((g) => `
    <h4>${g.label}</h4>
    <div class="mf-grid">${NUTRIENTS.filter((n) => n.group === g.id).map(nutrientInput).join('')}</div>`).join('');
}

function setMyFoodBasis(basis) {
  state.mfBasis = basis;
  document.querySelectorAll('#mf-basis-seg button').forEach((b) => {
    const on = b.dataset.val === basis;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#mf-serving').hidden = basis !== 'serving';
}

function resetMyFoodForm() {
  $('#mf-form').reset();
  state.mfEditId = null;
  setMyFoodBasis('100g');
  $('#mf-title').textContent = 'マイ食品を登録';
  $('#mf-submit').textContent = '登録';
  $('#mf-cancel').hidden = !state.returnTo;
  $('#mf-cancel').textContent = state.returnTo ? '記録に戻る' : '編集をやめる';
  $('#mf-return-note').hidden = !state.returnTo;
}

function fillMyFoodForm(f) {
  resetMyFoodForm();
  state.mfEditId = f.id;
  $('#mf-name').value = f.name;
  setMyFoodBasis(f.basis);
  $('#mf-serving-label').value = f.servingLabel || '1食';
  $('#mf-serving-grams').value = f.servingGrams ?? '';
  NUTRIENTS.forEach((n) => { $(`#mf-v-${n.key}`).value = f.values[n.key] ?? ''; });
  $('#mf-title').textContent = `「${f.name}」を編集`;
  $('#mf-submit').textContent = '更新';
  $('#mf-cancel').hidden = false;
  $('#mf-cancel').textContent = '編集をやめる';
  $('#mf-name').focus();
}

function onMyFoodSubmit(e) {
  e.preventDefault();
  const name = $('#mf-name').value.trim();
  const values = {};
  NUTRIENTS.forEach((n) => {
    const v = parseFloat($(`#mf-v-${n.key}`).value);
    if (!Number.isNaN(v) && v >= 0) values[n.key] = v;
  });
  if (!name) { showToast('名前を入力してください'); $('#mf-name').focus(); return; }
  if (values.kcal == null) { showToast('エネルギー（kcal）を入力してください'); $('#mf-v-kcal').focus(); return; }
  const grams = parseFloat($('#mf-serving-grams').value);
  const food = {
    id: state.mfEditId || `my:${Date.now().toString(36)}`,
    name,
    basis: state.mfBasis,
    servingLabel: state.mfBasis === 'serving' ? ($('#mf-serving-label').value.trim() || '1食') : null,
    servingGrams: state.mfBasis === 'serving' && !Number.isNaN(grams) && grams > 0 ? grams : null,
    values,
  };
  const list = state.data.myFoods;
  const idx = list.findIndex((f) => f.id === food.id);
  if (idx >= 0) list[idx] = food; else list.push(food);
  persist();
  showToast(idx >= 0 ? '更新しました' : '登録しました');

  // 記録画面の検索から来たときは、その料理に追加して戻る
  const back = state.returnTo;
  state.returnTo = null;
  resetMyFoodForm();
  renderMyFoods();
  if (back && idx < 0) {
    showView('today');
    pickFood(food.id, food.name, back);
  }
}

function renderMyFoods() {
  const list = state.data.myFoods;
  $('#mf-list').innerHTML = list.length === 0
    ? '<p class="empty">まだ登録はありません。</p>'
    : list.map((f) => `
      <div class="mf-row">
        <div class="mf-info"><b>${esc(f.name)}</b><small>${esc(myFoodBasisText(f))}・${Math.round(f.values.kcal || 0)} kcal</small></div>
        ${state.mfDeleteAsk === f.id
          ? `<div class="row-btns"><button type="button" class="danger-btn solid" data-action="mf-delete" data-id="${f.id}">削除する</button><button type="button" class="add-btn" data-action="mf-delete-cancel">やめる</button></div>`
          : `<div class="row-btns"><button type="button" class="add-btn" data-action="mf-edit" data-id="${f.id}">編集</button><button type="button" class="danger-btn" data-action="mf-delete-ask" data-id="${f.id}">削除</button></div>`}
      </div>`).join('');
}

/* ---------- 画面：設定 ---------- */

function renderConfig() {
  $('#cup-ml').value = state.data.settings.cupMl;
  renderProfile();
  renderMetsTable();
  renderSampleBanner();
}

function renderProfile() {
  const p = state.data.settings.profile;
  $('#pf-height').value = p.heightCm ?? '';
  $('#pf-birth').value = p.birthMonth || '';
  document.querySelectorAll('#pf-sex button').forEach((b) => {
    b.classList.toggle('on', b.dataset.val === p.sex);
    b.setAttribute('aria-pressed', String(b.dataset.val === p.sex));
  });
  $('#pf-activity').innerHTML = ACTIVITY_LEVELS.map((a) => `<button type="button" class="${a.v === p.activityLevel ? 'on' : ''}" aria-pressed="${a.v === p.activityLevel}" data-action="pf-activity" data-val="${a.v}">${a.label}</button>`).join('');
  const lv = ACTIVITY_LEVELS.find((a) => a.v === p.activityLevel);
  $('#pf-activity-desc').textContent = lv ? `${lv.desc}（係数 ${lv.v.toFixed(2)}）` : '';
  const age = ageAt(p.birthMonth, todayStr());
  $('#pf-status').textContent = profileComplete(p) ? `${age}歳として計算します。` : '身長・生年月・性別がそろうと、基礎代謝と収支を計算します。';
}

function renderMetsTable() {
  const mets = state.data.settings.mets;
  $('#mets-body').innerHTML = Object.keys(mets).map((type) => `
    <tr>
      <td>${esc(type)}</td>
      ${[0, 1, 2].map((i) => {
        const desc = metsDescription(mets, type, i + 1);
        return `<td><input type="number" inputmode="decimal" min="1" step="0.1" value="${mets[type][i]}" data-mets-type="${esc(type)}" data-mets-idx="${i}" aria-label="${esc(type)}の${INTENSITY[i].label}のMETs">${desc ? `<small>${esc(desc)}</small>` : ''}</td>`;
      }).join('')}
      <td><button type="button" class="icon-btn" data-action="mets-remove" data-type="${esc(type)}" aria-label="${esc(type)}を表から外す">×</button></td>
    </tr>`).join('');
}

function saveProfile(patch) {
  Object.assign(state.data.settings.profile, patch);
  persist();
  renderProfile();
}

function exportJson() {
  const records = {};
  Object.keys(state.data.records).sort().forEach((d) => {
    const r = state.data.records[d];
    if (!r.sample) records[d] = r;
  });
  return JSON.stringify({ records, myFoods: state.data.myFoods }, null, 2);
}

/* ---------- 画面の切り替えと表示 ---------- */

function showView(name) {
  saveIfDirty();
  state.view = name;
  VIEWS.forEach((v) => {
    $(`#view-${v}`).hidden = v !== name;
    $(`#tab-${v}`).setAttribute('aria-selected', String(v === name));
  });
  $('#savebar').hidden = name !== 'today';
  if (name === 'today') renderToday();
  if (name === 'week') renderWeek();
  if (name === 'foods') { renderMyFoods(); renderSampleBanner(); }
  if (name === 'config') renderConfig();
  window.scrollTo(0, 0);
}

function updateSaveStatus(kind) {
  const el = $('#save-status');
  const r = state.draft;
  const messages = {
    new: '未記録の日です',
    loaded: r && r.updatedAt ? `保存済み（${r.updatedAt.slice(11, 16)} 更新）` : '保存済み',
    dirty: '未保存の変更があります',
    saved: '保存しました',
    error: 'この端末に保存できませんでした。プライベートブラウズを解除してください',
  };
  el.textContent = messages[kind];
  el.className = `status ${kind === 'dirty' ? 'dirty' : ''} ${kind === 'error' ? 'error' : ''}`;
  $('#save-btn').disabled = !state.dirty;
}

let toastTimer = null;
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- ボタン操作 ---------- */

// 食事の区分を時刻から推測する
function guessMealKind() {
  const h = new Date().getHours();
  if (h < 10) return '朝食';
  if (h < 15) return '昼食';
  if (h < 17) return '間食';
  return '夕食';
}

function openSearch(i, j, k, query) {
  state.search = { i, j, k, query: query || '' };
  renderMeals();
  const input = $('#food-search-input');
  input.focus();
  input.select();
}

const actions = {
  'prev-day': () => setDate(addDays(state.draft.date, -1)),
  'next-day': () => setDate(addDays(state.draft.date, 1)),
  'go-today': () => setDate(todayStr()),
  save: () => {
    saveDraft();
    state.draft = normalize(state.data.records[state.draft.date] || emptyRecord(state.draft.date));
    state.search = null;
    renderToday();
  },

  'add-exercise': (el) => {
    state.draft.exercise.push({ type: el.dataset.type || '', minutes: null, intensity: 2 });
    markDirty();
    renderExercise();
    const rows = document.querySelectorAll('.ex-row');
    rows[rows.length - 1].querySelector(el.dataset.type ? 'input[type="number"]' : 'input').focus();
  },
  'remove-exercise': (el) => { state.draft.exercise.splice(+el.dataset.index, 1); markDirty(); renderExercise(); updateBalance(); },
  'set-intensity': (el) => { state.draft.exercise[+el.dataset.index].intensity = +el.dataset.val; markDirty(); renderExercise(); updateBalance(); },

  'add-meal': () => {
    state.draft.meals.push({ time: nowTime(), kind: guessMealKind(), items: [{ name: '', amount: '', ingredients: [] }] });
    state.search = null;
    markDirty();
    renderMeals();
    const meals = document.querySelectorAll('.meal');
    meals[meals.length - 1].querySelector('.dish input').focus();
  },
  'remove-meal': (el) => { state.draft.meals.splice(+el.dataset.index, 1); state.search = null; markDirty(); renderMeals(); },
  'add-item': (el) => {
    state.draft.meals[+el.dataset.index].items.push({ name: '', amount: '', ingredients: [] });
    state.search = null;
    markDirty();
    renderMeals();
    const dishes = document.querySelectorAll('.meal')[+el.dataset.index].querySelectorAll('.dish');
    dishes[dishes.length - 1].querySelector('input').focus();
  },
  'remove-item': (el) => { state.draft.meals[+el.dataset.index].items.splice(+el.dataset.item, 1); state.search = null; markDirty(); renderMeals(); },

  'add-ingredient': (el) => openSearch(+el.dataset.i, +el.dataset.j, null, ''),
  'edit-ingredient': (el) => {
    const g = state.draft.meals[+el.dataset.i].items[+el.dataset.j].ingredients[+el.dataset.k];
    openSearch(+el.dataset.i, +el.dataset.j, +el.dataset.k, g.foodId ? '' : g.name);
  },
  'remove-ingredient': (el) => {
    state.draft.meals[+el.dataset.i].items[+el.dataset.j].ingredients.splice(+el.dataset.k, 1);
    state.search = null;
    markDirty();
    renderMeals();
  },
  'pick-food': (el) => pickFood(el.dataset.ref, el.dataset.label, state.search),
  'close-search': () => { state.search = null; renderMeals(); },
  'search-myfood': () => {
    const q = state.search.query;
    state.returnTo = { i: state.search.i, j: state.search.j, k: state.search.k };
    state.search = null;
    showView('foods');
    resetMyFoodForm();
    $('#mf-name').value = q;
    $('#mf-name').focus();
  },

  'add-cup': () => { state.draft.waterMl = (state.draft.waterMl || 0) + state.data.settings.cupMl; $('#water-ml').value = state.draft.waterMl; markDirty(); updateWater(); },
  'remove-cup': () => { state.draft.waterMl = Math.max(0, (state.draft.waterMl || 0) - state.data.settings.cupMl); $('#water-ml').value = state.draft.waterMl || ''; markDirty(); updateWater(); },

  // 同じ数字をもう一度押すと未入力に戻る
  'set-cond': (el) => {
    const c = state.draft.condition;
    const v = +el.dataset.val;
    c[el.dataset.key] = c[el.dataset.key] === v ? null : v;
    markDirty();
    renderCondition();
  },

  'open-day': (el) => { setDate(el.dataset.date); showView('today'); },

  'mf-basis': (el) => setMyFoodBasis(el.dataset.val),

  'pf-sex': (el) => saveProfile({ sex: el.dataset.val }),
  'pf-activity': (el) => saveProfile({ activityLevel: +el.dataset.val }),
  'mets-add': () => {
    const name = $('#mets-new').value.trim();
    if (!name) { $('#mets-new').focus(); return; }
    if (!state.data.settings.mets[name]) state.data.settings.mets[name] = [...FALLBACK_METS];
    $('#mets-new').value = '';
    persist();
    renderMetsTable();
    showToast(`「${name}」を追加しました。METsを調整してください`);
  },
  'mets-reset': () => {
    Object.keys(DEFAULT_METS).forEach((k) => { state.data.settings.mets[k] = [...DEFAULT_METS[k]]; });
    persist();
    renderMetsTable();
    showToast('表の値に戻しました');
  },
  'mets-remove': (el) => {
    delete state.data.settings.mets[el.dataset.type];
    persist();
    renderMetsTable();
  },
  'mf-cancel': () => {
    const back = state.returnTo;
    state.returnTo = null;
    resetMyFoodForm();
    if (back) showView('today');
  },
  'mf-edit': (el) => fillMyFoodForm(state.data.myFoods.find((f) => f.id === el.dataset.id)),
  'mf-delete-ask': (el) => { state.mfDeleteAsk = el.dataset.id; renderMyFoods(); },
  'mf-delete-cancel': () => { state.mfDeleteAsk = null; renderMyFoods(); },
  'mf-delete': (el) => {
    state.data.myFoods = state.data.myFoods.filter((f) => f.id !== el.dataset.id);
    state.mfDeleteAsk = null;
    if (state.mfEditId === el.dataset.id) resetMyFoodForm();
    persist();
    renderMyFoods();
    showToast('削除しました（過去の記録の栄養はそのまま残ります）');
  },

  'remove-samples': () => {
    saveIfDirty();
    Object.keys(state.data.records).forEach((d) => { if (state.data.records[d].sample) delete state.data.records[d]; });
    persist();
    showToast('サンプルを削除しました');
    setDate(state.draft.date);
    showView(state.view);
  },

  'show-export': () => {
    const ta = $('#export-json');
    ta.value = exportJson();
    ta.hidden = false;
    $('#copy-btn').hidden = false;
  },
  'copy-export': () => {
    const ta = $('#export-json');
    navigator.clipboard.writeText(ta.value)
      .then(() => showToast('コピーしました'))
      .catch(() => { ta.focus(); ta.select(); showToast('選択しました。コピーしてください'); });
  },

  'ask-delete-all': () => { $('#delete-confirm').hidden = false; },
  'cancel-delete': () => { $('#delete-confirm').hidden = true; },
  'delete-all': () => {
    state.data.records = {};
    persist();
    state.dirty = false;
    $('#delete-confirm').hidden = true;
    $('#export-json').hidden = true;
    $('#copy-btn').hidden = true;
    setDate(todayStr());
    renderConfig();
    showToast('すべての記録を削除しました');
  },
};

/* ---------- 起動 ---------- */

function init() {
  state.data = loadData();
  persist();
  buildMyFoodForm();
  resetMyFoodForm();

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) { showView(tab.dataset.view); return; }
    const row = e.target.closest('tr[data-date]');
    if (row) { actions['open-day'](row); return; }
    const btn = e.target.closest('[data-action]');
    if (btn && actions[btn.dataset.action]) actions[btn.dataset.action](btn);
  });
  document.addEventListener('keydown', (e) => {
    const row = e.target.closest && e.target.closest('tr[data-date]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); actions['open-day'](row); }
    if (e.target.id === 'food-search-input' && e.key === 'Escape') actions['close-search']();
    if (e.target.id === 'food-search-input' && e.key === 'Enter') {
      e.preventDefault();
      const first = document.querySelector('#food-results [data-action="pick-food"]');
      if (first) first.click();
    }
  });
  $('#view-today').addEventListener('input', onInput);
  $('#mf-form').addEventListener('submit', onMyFoodSubmit);

  $('#pf-height').addEventListener('change', (e) => {
    const n = parseFloat(e.target.value);
    saveProfile({ heightCm: !Number.isNaN(n) && n >= 100 && n <= 250 ? Math.round(n * 10) / 10 : null });
  });
  $('#pf-birth').addEventListener('change', (e) => saveProfile({ birthMonth: e.target.value }));
  $('#mets-body').addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset.metsType) return;
    const n = parseFloat(el.value);
    if (Number.isNaN(n) || n < 1) { renderMetsTable(); return; }
    state.data.settings.mets[el.dataset.metsType][+el.dataset.metsIdx] = n;
    persist();
    renderMetsTable();
  });

  $('#cup-ml').addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10);
    if (Number.isNaN(n) || n < 50) { e.target.value = state.data.settings.cupMl; return; }
    state.data.settings.cupMl = n;
    persist();
    showToast(`1杯を${n}mLにしました`);
  });

  // 画面を閉じる・アプリを切り替えるときは自動で保存する
  window.addEventListener('pagehide', saveIfDirty);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveIfDirty(); });

  setDate(todayStr());
  const start = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
  showView(start);

  // 成分表は大きいので、画面を出してから読み込む
  loadFoodDb().then(() => {
    if (resolveSampleIngredients() && !state.dirty) {
      state.draft = state.data.records[state.draft.date] ? normalize(state.data.records[state.draft.date]) : state.draft;
    }
    if (state.view === 'today') renderMeals();
    if (state.view === 'week') renderWeek();
  });
}

init();
