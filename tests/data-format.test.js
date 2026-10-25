'use strict';

/* =========================================================
   データの形（版番号・削除の印）のテスト
   実行：node --test tests/
   ========================================================= */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app');

// 自分の記録が2日分、削除の印が1日分、マイ食品が2件あるデータ
function sampleData() {
  return {
    schemaVersion: 1,
    records: {
      '2026-10-01': { date: '2026-10-01', body: { weightKg: 70.0 }, waterMl: 200, updatedAt: '2026-10-01T21:00:00+09:00' },
      '2026-10-02': { date: '2026-10-02', deleted: true, updatedAt: '2026-10-02T21:00:00+09:00' },
      '2026-10-03': { date: '2026-10-03', body: { weightKg: 69.5 }, updatedAt: '2026-10-03T21:00:00+09:00' },
    },
    settings: {},
    myFoods: [
      { id: 'my:a', name: 'サラダチキン', basis: 'serving', servingLabel: '1袋', servingGrams: null, values: { kcal: 120 }, updatedAt: null },
      { id: 'my:b', name: 'プロテインバー', basis: 'serving', servingLabel: '1本', servingGrams: null, values: { kcal: 200 }, updatedAt: null },
    ],
  };
}

test('getRecord：削除の印やない日は null、ある日は記録を返す', () => {
  const app = loadApp(sampleData());
  assert.equal(app('getRecord("2026-10-01")').waterMl, 200);
  assert.equal(app('getRecord("2026-10-02")'), null); // 削除の印
  assert.equal(app('getRecord("2026-09-30")'), null); // 記録なし
});

test('liveRecords：削除の印を除き、日付の古い順に並ぶ', () => {
  const app = loadApp(sampleData());
  assert.deepEqual(app.value('liveRecords().map((r) => r.date)'), ['2026-10-01', '2026-10-03']);
});

test('体重の計算は削除の印を無視する', () => {
  const app = loadApp(sampleData());
  // 10/2 は削除の印なので、10/1 の体重が使われる
  assert.equal(app('weightFor("2026-10-02")'), 70.0);
  assert.equal(app('weightFor("2026-10-03")'), 69.5);
});

test('記録を空にして保存すると、削除の印が残る', () => {
  const app = loadApp(sampleData());
  app('setDate("2026-10-01"); state.draft.waterMl = 0; state.draft.body.weightKg = null; state.dirty = true; saveDraft();');
  const r = app.saved().records['2026-10-01'];
  assert.equal(r.deleted, true);
  assert.equal(r.date, '2026-10-01');
  assert.match(r.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(r.waterMl, undefined); // 中身は残さない
});

test('記録のない日を空のまま保存しても、削除の印は作らない', () => {
  const app = loadApp(sampleData());
  app('setDate("2026-09-30"); state.dirty = true; saveDraft();');
  assert.equal('2026-09-30' in app.saved().records, false);
});

test('サンプルの日を空にして保存すると、印を残さず消える', () => {
  const app = loadApp(); // 初回起動：サンプルが入る
  const date = app('Object.keys(state.data.records).find((d) => state.data.records[d].sample)');
  assert.ok(date, 'サンプルの日があること');
  app(`setDate("${date}"); state.draft = emptyRecord("${date}"); state.dirty = true; saveDraft();`);
  assert.equal(date in app.saved().records, false);
});

test('削除の印の日を開くと、空の記録になる', () => {
  const app = loadApp(sampleData());
  app('setDate("2026-10-02")');
  assert.equal(app('state.draft.deleted'), undefined);
  assert.equal(app('state.draft.waterMl'), 0);
});

test('削除の印の日にもう一度記録すると、普通の記録に戻る', () => {
  const app = loadApp(sampleData());
  app('setDate("2026-10-02"); state.draft.waterMl = 400; state.dirty = true; saveDraft();');
  const r = app.saved().records['2026-10-02'];
  assert.equal(r.deleted, undefined);
  assert.equal(r.waterMl, 400);
});

test('マイ食品の削除：印がつき、一覧と検索から消え、栄養の値は残る', () => {
  const app = loadApp(sampleData());
  app('actions["mf-delete"]({ dataset: { id: "my:a" } })');
  const f = app.saved().myFoods.find((m) => m.id === 'my:a');
  assert.equal(f.deleted, true);
  assert.ok(f.updatedAt);
  assert.deepEqual(app.value('activeMyFoods().map((m) => m.id)'), ['my:b']);
  assert.equal(app('searchFoods("サラダ", [], activeMyFoods()).length'), 0);
  // 過去の記録の再計算に使えるよう、値は残っている
  assert.equal(app('foodNutrition("my:a", state.data.myFoods).values.kcal'), 120);
});

test('すべての記録を削除：自分の記録は削除の印に、サンプルは消える', () => {
  const data = sampleData();
  data.records['2026-09-01'] = { date: '2026-09-01', waterMl: 100, sample: true };
  const app = loadApp(data);
  app('actions["delete-all"]()');
  const records = app.saved().records;
  assert.deepEqual(Object.keys(records).sort(), ['2026-10-01', '2026-10-02', '2026-10-03']);
  Object.values(records).forEach((r) => assert.equal(r.deleted, true));
});

test('保存データと書き出しに版番号がつき、書き出しには削除の印とサンプルが入らない', () => {
  const data = sampleData();
  data.records['2026-09-01'] = { date: '2026-09-01', waterMl: 100, sample: true };
  data.myFoods[1].deleted = true;
  const app = loadApp(data);
  assert.equal(app.saved().schemaVersion, 1);
  const out = JSON.parse(app('exportJson()'));
  assert.equal(out.schemaVersion, 1);
  assert.deepEqual(Object.keys(out.records), ['2026-10-01', '2026-10-03']);
  assert.deepEqual(out.myFoods.map((m) => m.id), ['my:a']);
});

test('版番号がない古いデータも読め、保存し直すと版番号がつく', () => {
  const app = loadApp({
    records: { '2026-10-01': { date: '2026-10-01', body: { weightKg: 70 }, meals: [{ items: [{ name: '朝食', ingredients: ['ごはん'] }] }] } },
    settings: {},
    myFoods: [],
  });
  assert.equal(app('getRecord("2026-10-01").body.weightKg'), 70);
  assert.equal(app.saved().schemaVersion, 1);
});

test('マイ食品を登録すると updatedAt がつく', () => {
  const app = loadApp(sampleData());
  // フォームの入力欄に値を入れて登録する
  app.inputs['#mf-name'] = 'ゆで卵';
  app.inputs['#mf-v-kcal'] = '80';
  app('state.mfBasis = "100g"; onMyFoodSubmit({ preventDefault() {} });');
  const f = app.saved().myFoods.find((m) => m.name === 'ゆで卵');
  assert.ok(f, '登録されていること');
  assert.match(f.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
