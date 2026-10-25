'use strict';

/* =========================================================
   栄養素の定義・成分表の読み込み・食材検索・栄養計算
   出典：日本食品標準成分表（八訂）増補2023年（文部科学省）
   ========================================================= */

// アプリで扱う栄養素。code は成分表の「成分識別子」
// group: main=主な栄養素 / macro=主要成分の詳細 / mineral=ミネラル / vitamin=ビタミン
const NUTRIENTS = [
  { key: 'kcal', code: 'ENERC_KCAL', label: 'エネルギー', unit: 'kcal', group: 'main', digits: 0 },
  { key: 'protein', code: 'PROT-', label: 'たんぱく質', unit: 'g', group: 'main', digits: 1 },
  { key: 'fat', code: 'FAT-', label: '脂質', unit: 'g', group: 'main', digits: 1 },
  { key: 'carbs', code: 'CHOCDF-', label: '炭水化物', unit: 'g', group: 'main', digits: 1 },
  { key: 'fiber', code: 'FIB-', label: '食物繊維', unit: 'g', group: 'main', digits: 1 },
  { key: 'salt', code: 'NACL_EQ', label: '食塩相当量', unit: 'g', group: 'main', digits: 1 },

  { key: 'energyKj', code: 'ENERC', label: 'エネルギー（kJ）', unit: 'kJ', group: 'macro', digits: 0 },
  { key: 'water', code: 'WATER', label: '水分', unit: 'g', group: 'macro', digits: 1 },
  { key: 'proteinAA', code: 'PROTCAA', label: 'アミノ酸組成によるたんぱく質', unit: 'g', group: 'macro', digits: 1 },
  { key: 'fatTG', code: 'FATNLEA', label: '脂肪酸のトリアシルグリセロール当量', unit: 'g', group: 'macro', digits: 1 },
  { key: 'cholesterol', code: 'CHOLE', label: 'コレステロール', unit: 'mg', group: 'macro', digits: 0 },
  { key: 'carbsAvailMono', code: 'CHOAVLM', label: '利用可能炭水化物（単糖当量）', unit: 'g', group: 'macro', digits: 1 },
  { key: 'carbsAvail', code: 'CHOAVL', label: '利用可能炭水化物（質量計）', unit: 'g', group: 'macro', digits: 1 },
  { key: 'carbsDiff', code: 'CHOAVLDF-', label: '差引き法による利用可能炭水化物', unit: 'g', group: 'macro', digits: 1 },
  { key: 'polyol', code: 'POLYL', label: '糖アルコール', unit: 'g', group: 'macro', digits: 1 },
  { key: 'organicAcid', code: 'OA', label: '有機酸', unit: 'g', group: 'macro', digits: 1 },
  { key: 'ash', code: 'ASH', label: '灰分', unit: 'g', group: 'macro', digits: 1 },
  { key: 'alcohol', code: 'ALC', label: 'アルコール', unit: 'g', group: 'macro', digits: 1 },

  { key: 'sodium', code: 'NA', label: 'ナトリウム', unit: 'mg', group: 'mineral', digits: 0 },
  { key: 'potassium', code: 'K', label: 'カリウム', unit: 'mg', group: 'mineral', digits: 0 },
  { key: 'calcium', code: 'CA', label: 'カルシウム', unit: 'mg', group: 'mineral', digits: 0 },
  { key: 'magnesium', code: 'MG', label: 'マグネシウム', unit: 'mg', group: 'mineral', digits: 0 },
  { key: 'phosphorus', code: 'P', label: 'リン', unit: 'mg', group: 'mineral', digits: 0 },
  { key: 'iron', code: 'FE', label: '鉄', unit: 'mg', group: 'mineral', digits: 1 },
  { key: 'zinc', code: 'ZN', label: '亜鉛', unit: 'mg', group: 'mineral', digits: 1 },
  { key: 'copper', code: 'CU', label: '銅', unit: 'mg', group: 'mineral', digits: 2 },
  { key: 'manganese', code: 'MN', label: 'マンガン', unit: 'mg', group: 'mineral', digits: 2 },
  { key: 'iodine', code: 'ID', label: 'ヨウ素', unit: 'µg', group: 'mineral', digits: 0 },
  { key: 'selenium', code: 'SE', label: 'セレン', unit: 'µg', group: 'mineral', digits: 0 },
  { key: 'chromium', code: 'CR', label: 'クロム', unit: 'µg', group: 'mineral', digits: 0 },
  { key: 'molybdenum', code: 'MO', label: 'モリブデン', unit: 'µg', group: 'mineral', digits: 0 },

  { key: 'vitaminA', code: 'VITA_RAE', label: 'ビタミンA（レチノール活性当量）', unit: 'µg', group: 'vitamin', digits: 0 },
  { key: 'retinol', code: 'RETOL', label: 'レチノール', unit: 'µg', group: 'vitamin', digits: 0 },
  { key: 'caroteneA', code: 'CARTA', label: 'α-カロテン', unit: 'µg', group: 'vitamin', digits: 0 },
  { key: 'caroteneB', code: 'CARTB', label: 'β-カロテン', unit: 'µg', group: 'vitamin', digits: 0 },
  { key: 'cryptoxanthin', code: 'CRYPXB', label: 'β-クリプトキサンチン', unit: 'µg', group: 'vitamin', digits: 0 },
  { key: 'caroteneBEq', code: 'CARTBEQ', label: 'β-カロテン当量', unit: 'µg', group: 'vitamin', digits: 0 },
  { key: 'vitaminD', code: 'VITD', label: 'ビタミンD', unit: 'µg', group: 'vitamin', digits: 1 },
  { key: 'tocopherolA', code: 'TOCPHA', label: 'ビタミンE（α-トコフェロール）', unit: 'mg', group: 'vitamin', digits: 1 },
  { key: 'tocopherolB', code: 'TOCPHB', label: 'β-トコフェロール', unit: 'mg', group: 'vitamin', digits: 1 },
  { key: 'tocopherolG', code: 'TOCPHG', label: 'γ-トコフェロール', unit: 'mg', group: 'vitamin', digits: 1 },
  { key: 'tocopherolD', code: 'TOCPHD', label: 'δ-トコフェロール', unit: 'mg', group: 'vitamin', digits: 1 },
  { key: 'vitaminK', code: 'VITK', label: 'ビタミンK', unit: 'µg', group: 'vitamin', digits: 0 },
  { key: 'vitaminB1', code: 'THIA', label: 'ビタミンB1', unit: 'mg', group: 'vitamin', digits: 2 },
  { key: 'vitaminB2', code: 'RIBF', label: 'ビタミンB2', unit: 'mg', group: 'vitamin', digits: 2 },
  { key: 'niacin', code: 'NIA', label: 'ナイアシン', unit: 'mg', group: 'vitamin', digits: 1 },
  { key: 'niacinEq', code: 'NE', label: 'ナイアシン当量', unit: 'mg', group: 'vitamin', digits: 1 },
  { key: 'vitaminB6', code: 'VITB6A', label: 'ビタミンB6', unit: 'mg', group: 'vitamin', digits: 2 },
  { key: 'vitaminB12', code: 'VITB12', label: 'ビタミンB12', unit: 'µg', group: 'vitamin', digits: 1 },
  { key: 'folate', code: 'FOL', label: '葉酸', unit: 'µg', group: 'vitamin', digits: 0 },
  { key: 'pantothenic', code: 'PANTAC', label: 'パントテン酸', unit: 'mg', group: 'vitamin', digits: 2 },
  { key: 'biotin', code: 'BIOT', label: 'ビオチン', unit: 'µg', group: 'vitamin', digits: 1 },
  { key: 'vitaminC', code: 'VITC', label: 'ビタミンC', unit: 'mg', group: 'vitamin', digits: 0 },
];

const NUTRIENT_GROUPS = [
  { id: 'main', label: '主な栄養素' },
  { id: 'macro', label: '主要成分の詳細' },
  { id: 'mineral', label: 'ミネラル' },
  { id: 'vitamin', label: 'ビタミン' },
];

const MAIN_NUTRIENTS = NUTRIENTS.filter((n) => n.group === 'main');
const FOOD_SOURCE = '日本食品標準成分表（八訂）増補2023年（文部科学省）';

/* ---------- 成分表の読み込み ---------- */

// 成分表データ（foods.json）を読み込んだ結果
const FoodDB = {
  status: 'loading', // loading / ready / error
  foods: new Map(),  // 食品番号 → { id, name, group, search, values }
  list: [],
  aliases: [],       // よく使う食材の呼び名 { label, id, search }
};

async function loadFoodDb() {
  try {
    const res = await fetch('foods.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // 成分表の列の順番 → アプリの栄養素キー の対応を作る
    const indexOf = {};
    json.keys.forEach((code, i) => { indexOf[code] = i; });
    // 1件の形：[食品番号, 食品名, 食品群, 別名, 成分の値...]
    json.foods.forEach(([id, name, group, alt, ...vals]) => {
      const values = {};
      NUTRIENTS.forEach((n) => {
        const v = vals[indexOf[n.code]];
        if (typeof v === 'number') values[n.key] = v;
      });
      const food = { id, name, group, alt, values, search: normalizeText(`${group}${name}${alt}`) };
      FoodDB.foods.set(id, food);
      FoodDB.list.push(food);
    });
    FoodDB.aliases = (json.aliases || [])
      .filter((a) => FoodDB.foods.has(a.id))
      // 呼び名でも成分表の食品名でも見つかるようにする
      .map((a) => ({ ...a, search: normalizeText(a.label) + FoodDB.foods.get(a.id).search }));
    FoodDB.status = 'ready';
  } catch (e) {
    FoodDB.status = 'error';
  }
}

/* ---------- 食材検索 ---------- */

// 検索用に文字をそろえる：全角→半角、カタカナ→ひらがな、空白・括弧を除く
function normalizeText(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
    .replace(/[\s<>\[\]()「」『』・、，,.。/／\-－]/g, '');
}

// 成分表の食品名はひらがなが多いので、よく使う漢字・言い方を言い換える
const SYNONYMS = {
  '鶏': ['にわとり', 'とり'], '豚': ['ぶた'], '牛': ['うし', 'ぎゅう'],
  'とり': ['にわとり'], 'ぶた': ['ぶた'], 'ぎゅう': ['うし'],
  '胸': ['むね'], '腿': ['もも'], 'むね': ['むね'], 'もも': ['もも'], 'ささみ': ['ささみ'], 'ひき肉': ['ひき肉'],
  '卵': ['鶏卵', 'たまご'],
  '玉ねぎ': ['たまねぎ'], '玉葱': ['たまねぎ'], '人参': ['にんじん'], '大根': ['だいこん'],
  '白菜': ['はくさい'], '胡瓜': ['きゅうり'], '茄子': ['なす'], '南瓜': ['かぼちゃ'],
  '馬鈴薯': ['じゃがいも'], 'ジャガイモ': ['じゃがいも'], '葱': ['ねぎ'], '生姜': ['しょうが'],
  'ご飯': ['めし', 'ごはん'], 'ごはん': ['めし', 'ご飯'], 'ライス': ['めし', 'ご飯'], '米': ['こめ'],
  '鮭': ['さけ', 'しろさけ'], '鯖': ['さば'], '鰯': ['いわし'], '鮪': ['まぐろ'],
  '牛乳': ['普通牛乳'], '砂糖': ['車糖', 'さとう'], '醤油': ['しょうゆ'], '味噌': ['みそ'],
  'オリーブオイル': ['オリーブ油'], 'サラダ油': ['調合油'],
};
// 長い言い方から先に探す（「牛乳」を「牛」と「乳」に分けないため）
const SYNONYM_KEYS = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);

// 検索語を単語に分ける。言い換え辞書にある語はそこで区切る（例：鶏もも → 鶏 / もも）
function splitQuery(q) {
  const words = [];
  let buf = '';
  const flush = () => { words.push(...buf.split(/\s+/).filter(Boolean)); buf = ''; };
  for (let i = 0; i < q.length;) {
    const key = SYNONYM_KEYS.find((k) => q.startsWith(k, i));
    if (key) { flush(); words.push(key); i += key.length; } else { buf += q[i]; i += 1; }
  }
  flush();
  return words;
}

// 検索語を「すべて含まれていれば一致」の単語に分け、それぞれに言い換え候補をつける
function queryTerms(query) {
  return splitQuery(String(query || '').normalize('NFKC'))
    .map((t) => [t, ...(SYNONYMS[t] || [])].map(normalizeText).filter(Boolean))
    .filter((v) => v.length > 0);
}

function matches(search, terms) {
  return terms.every((variants) => variants.some((v) => search.includes(v)));
}

// 食材を検索する。返り値：{ ref, label, sub, per100kcal } の配列
// recentIds：最近使った食品のID（上位に出す） myFoods：マイ食品
function searchFoods(query, recentIds, myFoods) {
  const terms = queryTerms(query);
  const results = [];
  const seen = new Set();
  // 同じ食品は1回だけ出す（先に見つかった呼び名を優先）
  const push = (item) => { if (!seen.has(item.ref)) { seen.add(item.ref); results.push(item); } };

  // 1. マイ食品
  myFoods.forEach((f) => {
    if (terms.length === 0 || matches(normalizeText(f.name), terms)) {
      push({ ref: f.id, label: f.name, sub: `マイ食品・${myFoodBasisText(f)}`, kcal: f.values.kcal, kcalUnit: myFoodBasisText(f) });
    }
  });
  if (FoodDB.status !== 'ready') return results;

  // 2. 最近使った食材（検索語が空なら最近使ったものだけを出す）
  recentIds.forEach((r) => {
    const food = FoodDB.foods.get(r.id);
    if (!food) return;
    if (terms.length === 0 || matches(food.search, terms) || matches(normalizeText(r.label), terms)) {
      push({ ref: food.id, label: r.label, sub: `最近使った・${displayFoodName(food.name)}`, kcal: food.values.kcal, kcalUnit: '100gあたり' });
    }
  });
  if (terms.length === 0) return results.slice(0, 12);

  // 3. よく使う食材の呼び名
  FoodDB.aliases.forEach((a) => {
    if (matches(a.search, terms)) {
      const food = FoodDB.foods.get(a.id);
      push({ ref: a.id, label: a.label, sub: displayFoodName(food.name), kcal: food.values.kcal, kcalUnit: '100gあたり' });
    }
  });

  // 4. 成分表の全食品（食品名が短いものを先に）
  FoodDB.list
    .filter((f) => matches(f.search, terms))
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, 40)
    .forEach((f) => push({ ref: f.id, label: displayFoodName(f.name), sub: `成分表 ${f.id}`, kcal: f.values.kcal, kcalUnit: '100gあたり' }));

  return results.slice(0, 15);
}

// 成分表の食品名から先頭の分類（＜鳥肉類＞など）を外し、空白をそろえる
function displayFoodName(name) {
  return String(name).replace(/^[＜<][^＞>]*[＞>]\s*/, '').replace(/[\s　]+/g, ' ').trim();
}

/* ---------- 栄養計算 ---------- */

// 食品の参照（成分表の食品番号 or "my:..."）から、栄養価の基準と値を取り出す
// basis: '100g'（100gあたり） / 'serving'（1食・1個あたり）
function foodNutrition(ref, myFoods) {
  if (String(ref).startsWith('my:')) {
    const f = myFoods.find((m) => m.id === ref);
    if (!f) return null;
    return { basis: f.basis, servingGrams: f.servingGrams || null, servingLabel: f.servingLabel || '1食', values: f.values };
  }
  const food = FoodDB.foods.get(ref);
  if (!food) return null;
  return { basis: '100g', servingGrams: null, servingLabel: null, values: food.values };
}

// 食材の量から栄養素を計算する。
// grams があれば g で計算（100gあたり、または1食の重さがわかっているマイ食品）
// servings があれば 1食あたりの値 × 食数 で計算
function calcIngredient(nutrition, grams, servings) {
  if (!nutrition) return null;
  let factor = null;
  if (nutrition.basis === '100g' && grams != null) factor = grams / 100;
  else if (nutrition.basis === 'serving' && nutrition.servingGrams && grams != null) factor = grams / nutrition.servingGrams;
  else if (nutrition.basis === 'serving' && servings != null) factor = servings;
  if (factor === null) return null;
  const out = {};
  NUTRIENTS.forEach((n) => {
    const v = nutrition.values[n.key];
    if (typeof v === 'number' && v !== 0) out[n.key] = Math.round(v * factor * 1000) / 1000;
  });
  return out;
}

// 栄養素オブジェクトを足し合わせる
function sumNutrients(list) {
  const total = {};
  list.forEach((obj) => {
    if (!obj) return;
    Object.keys(obj).forEach((k) => { total[k] = (total[k] || 0) + obj[k]; });
  });
  return total;
}

function formatNutrient(n, value) {
  const v = value || 0;
  return v.toLocaleString('ja-JP', { minimumFractionDigits: n.digits, maximumFractionDigits: n.digits });
}

function myFoodBasisText(f) {
  if (f.basis === '100g') return '100gあたり';
  return f.servingGrams ? `${f.servingLabel || '1食'}（${f.servingGrams}g）あたり` : `${f.servingLabel || '1食'}あたり`;
}
