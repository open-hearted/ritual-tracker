// schedule.js
// 運用方針: ここは「設定(変数)だけ」を編集すればOK。
// JS本体(ロジック)を触らずに、引っ越し後もここだけ差し替え/編集で対応できます。
//
// weekday: 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
// type:
// - "weekly": 毎週
// - "nthWeekday": 第n週の曜日 (例: 第2/第4火曜)

window.RITUAL_SCHEDULE = {
  garbage: [
    {
      type: "nthWeekday",
      weekday: 2,
      nth: [2, 4],
      label: "金属・陶器・ガラスごみ",
      short: "金属/陶/ガ",
      icon: "♻"
    },
    {
      type: "weekly",
      weekday: 5,
      label: "びん・かん・ペットボトル",
      short: "びん/かん/PET",
      icon: "♻"
    },
    {
      type: "weekly",
      weekday: 6,
      label: "段ボール・紙・布類・プラスチック",
      short: "紙/布/プラ",
      icon: "♻"
    }
  ]
};
