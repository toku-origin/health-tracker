'use strict';

/* =========================================================
   テスト用：ブラウザなしで app.js を読み込む
   - nutrients.js → body.js → app.js の順に、Node の vm で同じ「グローバル」に読み込む
   - 画面（document）と localStorage は、最小限のにせもの（スタブ）で置き換える
   - 画面を描く関数は何もしない関数に差し替え、データの処理だけを確かめる
   ========================================================= */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// localStorage のにせもの。中身はただのオブジェクト
function fakeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

// document のにせもの。どの要素を探しても、何もしない空の要素を返す
// inputs に { '#mf-name': 'ゆで卵' } のように入れておくと、その要素の value になる
function fakeElement(value = '') {
  return { hidden: false, value, innerHTML: '', textContent: '', classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, focus() {} };
}
function fakeDocument(inputs) {
  return {
    querySelector: (sel) => fakeElement(inputs[sel] ?? ''),
    querySelectorAll: () => [],
    addEventListener() {},
  };
}

// app.js を読み込んだ「アプリの世界」（context）を返す
// saved：localStorage に最初から入れておくデータ（なければ初回起動＝サンプルあり）
function loadApp(saved) {
  const initial = saved ? { 'health-tracker:v1': JSON.stringify(saved) } : {};
  const inputs = {};
  const context = vm.createContext({
    console,
    localStorage: fakeLocalStorage(initial),
    document: fakeDocument(inputs),
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: '' },
    navigator: {},
    fetch: () => new Promise(() => {}), // 成分表は読み込まない（ずっと読み込み中のまま）
    setTimeout,
    clearTimeout,
  });
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(read('nutrients.js'), context, { filename: 'nutrients.js' });
  vm.runInContext(read('body.js'), context, { filename: 'body.js' });
  // 最後の init(); は呼ばずに読み込み、画面を描く関数を差し替えてから自分で準備する
  const appSrc = read('app.js').replace(/\ninit\(\);\s*$/, '\n');
  vm.runInContext(appSrc, context, { filename: 'app.js' });
  vm.runInContext(`
    renderToday = () => {};
    renderConfig = () => {};
    renderMyFoods = () => {};
    resetMyFoodForm = () => {};
    updateSaveStatus = () => {};
    showToast = () => {};
    state.data = loadData();
    persist();
    setDate(todayStr());
  `, context);
  // テストから式を評価する関数（例：app('getRecord("2026-10-01")')）
  const app = (code) => vm.runInContext(code, context);
  // 配列やオブジェクトを比べるときに使う。アプリの世界の値を、テスト側の普通の値にして返す
  // （vm の中で作った配列は、テスト側の配列と「別の世界の配列」なので、そのままだと比べられない）
  app.value = (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context));
  // 画面の入力欄に入っている値（セレクタ → 値）
  app.inputs = inputs;
  // localStorage に保存された中身を読む
  app.saved = () => JSON.parse(context.localStorage.getItem('health-tracker:v1'));
  return app;
}

module.exports = { loadApp };
