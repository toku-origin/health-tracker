'use strict';

/* =========================================================
   体重・運動の消費カロリー・基礎代謝の計算
   ========================================================= */

// 運動の種類ごとの METs。[軽い, 普通, きつい] の順に [METs, コード, 説明]
// 出典：改訂第2版『身体活動のメッツ(METs)表』成人版（2024）。コードは表の番号
const METS_DETAIL = {
  'ウォーキング': [
    [3.0, '17170', '4.0km/時、平らな道'],
    [3.8, '17190', '4.5〜5.5km/時、ほどほどのペース'],
    [4.8, '17200', '5.7〜6.3km/時、速歩き（運動目的）'],
  ],
  'ランニング': [
    [6.5, '12028', '6.5〜6.8km/時'],
    [8.5, '12030', '8.1〜8.4km/時'],
    [9.3, '12050', '9.7〜10.2km/時'],
  ],
  '筋トレ': [
    [3.0, '02056', '自重（スクワット・腕立て伏せなど）、全般'],
    [3.5, '02054', 'ウェイト、複数種目を8〜15回ずつ'],
    [6.0, '02050', 'ウェイト・マシン、きつい労力'],
  ],
  'ストレッチ': [
    [2.3, '02101', 'ゆったり'],
    [2.3, '02101', 'ゆったり（表に強度別の値なし）'],
    [2.3, '02101', 'ゆったり（表に強度別の値なし）'],
  ],
  '自転車': [
    [4.3, '01015', '自分で選んだ楽なペース'],
    [7.0, '01016', '自分で選んだほどほどのペース'],
    [9.0, '01017', '自分で選んだ激しいペース'],
  ],
  'エアロバイク': [
    [4.0, '01214', '50ワット、楽な労力'],
    [6.0, '01220', '90〜100ワット、ほどほどからきつい'],
    [8.0, '01228', '126〜150ワット'],
  ],
  'ヨガ': [
    [2.3, '02150', 'ハタヨガ'],
    [4.0, '02160', 'パワーヨガ'],
    [8.0, '02153', 'ハタヨガ、高強度'],
  ],
  '水泳': [
    [5.3, '18265', '平泳ぎ、レクリエーション'],
    [5.8, '18292', 'クロール、ゆっくり（27〜41m/分）'],
    [8.0, '18290', 'クロール、ふつうの速さ（46m/分未満）、きつい'],
  ],
  '水中歩行': [
    [2.5, '18367', '楽な労力、ゆっくり'],
    [4.8, '18368', 'ほどほどの労力・ペース'],
    [6.8, '18369', 'きつい労力、速いペース'],
  ],
  'ハイキング': [
    [3.8, '17081', '野原や丘をゆったり、荷物なし'],
    [5.3, '17082', '野原や丘をふつうのペースで、荷物なし'],
    [7.0, '17035', '山を登る、傾斜6〜10%、荷物なし'],
  ],
  '階段を上る': [
    [4.5, '17133', 'ゆっくりなペース'],
    [6.8, '17131', '全般'],
    [9.3, '17134', 'はやいペース、1段ずつ'],
  ],
};

// 設定に保存する形（[軽い, 普通, きつい] の METs だけ）
const DEFAULT_METS = Object.fromEntries(Object.entries(METS_DETAIL).map(([k, v]) => [k, v.map((x) => x[0])]));

// 初期値を変えたら上げる。保存済みの設定にある初期の運動を新しい値に置き換えるため
const METS_VERSION = 2;

// 表にない運動に使う仮の値（強度だけで決める）
const FALLBACK_METS = [3.0, 4.5, 6.0];

// 普段の活動量（身体活動レベル）。運動以外の生活での活動の多さ
// 出典：日本人の食事摂取基準（2025年版）
const ACTIVITY_LEVELS = [
  { v: 1.5, label: '低い', desc: '座り仕事が中心で、通勤や家事は軽め' },
  { v: 1.75, label: 'ふつう', desc: '座り仕事が中心でも、立ち仕事・移動・家事がそれなりにある' },
  { v: 2.0, label: '高い', desc: '立ち仕事や力仕事が多い' },
];

const DEFAULT_PROFILE = { heightCm: null, birthMonth: '', sex: null, activityLevel: 1.5 };

// 体脂肪1kgあたりのエネルギー（よく使われる目安）
const KCAL_PER_KG_FAT = 7200;

// 運動の種類と強度（1〜3）から METs を決める
function metsFor(metsTable, type, intensity) {
  const row = metsTable[type];
  const i = Math.min(Math.max((intensity || 2) - 1, 0), 2);
  return row ? row[i] : FALLBACK_METS[i];
}

// 運動の種類と強度の説明（表の値のまま使っているときだけ返す）
function metsDescription(metsTable, type, intensity) {
  const detail = METS_DETAIL[type];
  const i = Math.min(Math.max((intensity || 2) - 1, 0), 2);
  if (!detail || !metsTable[type] || metsTable[type][i] !== detail[i][0]) return '';
  return detail[i][2];
}

// 消費カロリー（kcal）= METs × 体重(kg) × 時間(時間)
function exerciseKcal(mets, weightKg, minutes) {
  if (!weightKg || !minutes) return null;
  return Math.round(mets * weightKg * (minutes / 60));
}

// 安静にしていても使う分（1 METs）を除いた、運動で上乗せされた分
// 1日の収支では、基礎代謝と二重に数えないようにこちらを足す
function exerciseExtraKcal(mets, weightKg, minutes) {
  if (!weightKg || !minutes) return 0;
  return Math.max(mets - 1, 0) * weightKg * (minutes / 60);
}

// 生年月（"1990-05"）と日付（"2026-10-26"）から満年齢を出す（日は無視）
function ageAt(birthMonth, dateStr) {
  if (!birthMonth) return null;
  const [by, bm] = birthMonth.split('-').map(Number);
  const [y, m] = dateStr.split('-').map(Number);
  return y - by - (m < bm ? 1 : 0);
}

// 基礎代謝量（kcal/日）
// 国立健康・栄養研究所の式（Ganpule et al., 2007。日本人の食事摂取基準2025年版でも紹介）
// [(0.0481×体重kg + 0.0234×身長cm − 0.0138×年齢 − 定数) × 1000 / 4.186]
// 定数：男性 0.4235 ／ 女性 0.9708
function basalMetabolism({ weightKg, heightCm, age, sex }) {
  if (!weightKg || !heightCm || age == null || !sex) return null;
  const c = sex === 'male' ? 0.4235 : 0.9708;
  return ((0.0481 * weightKg + 0.0234 * heightCm - 0.0138 * age - c) * 1000) / 4.186;
}

function calcBmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

// 日本肥満学会の判定区分
function bmiLabel(bmi) {
  if (bmi < 18.5) return '低体重';
  if (bmi < 25) return '普通体重';
  if (bmi < 30) return '肥満（1度）';
  if (bmi < 35) return '肥満（2度）';
  if (bmi < 40) return '肥満（3度）';
  return '肥満（4度）';
}

function profileComplete(p) { return Boolean(p.heightCm && p.birthMonth && p.sex); }

function signed(n, digits = 0) {
  const v = Number(n.toFixed(digits));
  const s = Math.abs(v).toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (v > 0) return `＋${s}`;
  if (v < 0) return `−${s}`;
  return s;
}
