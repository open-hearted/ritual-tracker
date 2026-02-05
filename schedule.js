// schedule.js
// 運用方針: ここは「設定(変数)だけ」を編集すればOK。
// JS本体(ロジック)を触らずに、引っ越し後もここだけ差し替え/編集で対応できます。
//
// weekday: 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
// type:
// - "weekly": 毎週
// - "nthWeekday": 第n週の曜日 (例: 第2/第4火曜)

window.RITUAL_SCHEDULE = {
  // ゴミ出し情報を開くURL（豊島区: さんあ〜る）
  // 必要に応じてここを書き換えるだけでOK。
  garbageInfoUrl: "https://manage.delight-system.com/threeR/web/benri?menu=benri&jichitaiId=toshimaku&areaId=149898&benriCateId=%2f&bunbetsuCateId=%2f&faqCateId=%2f&lang=ja",
  // 単発の予定 (YYYY-MM-DD + HH:MM)
  // 例: { date:"2026-01-26", time:"18:30", label:"鍼", icon:"🪡" }
  appointments: [
    { date: "2025-11-27", time: "19:45", label: "ACG2 3-01", short: "ACG2 3-01", icon: "", calendarTime: false },
    { date: "2025-12-11", time: "19:45", label: "ACG2 3-02", short: "ACG2 3-02", icon: "", calendarTime: false },
    { date: "2025-12-25", time: "19:45", label: "ACG2 3-03", short: "ACG2 3-03", icon: "", calendarTime: false },
    { date: "2026-01-08", time: "19:45", label: "ACG2 3-04", short: "ACG2 3-04", icon: "", calendarTime: false },
    { date: "2026-01-22", time: "19:45", label: "ACG2 3-05", short: "ACG2 3-05", icon: "", calendarTime: false },
    { date: "2026-02-12", time: "19:45", label: "ACG2 3-06", short: "ACG2 3-06", icon: "", calendarTime: false },
    { date: "2026-02-26", time: "19:45", label: "ACG2 3-07", short: "ACG2 3-07", icon: "", calendarTime: false },
    { date: "2026-03-12", time: "19:45", label: "ACG2 3-08", short: "ACG2 3-08", icon: "", calendarTime: false },
    { date: "2026-03-26", time: "19:45", label: "ACG2 3-09", short: "ACG2 3-09", icon: "", calendarTime: false },
    { date: "2026-04-09", time: "19:45", label: "ACG2 3-10", short: "ACG2 3-10", icon: "", calendarTime: false },
    { date: "2026-01-26", time: "18:30", label: "鍼", short: "鍼", icon: "🪡" },

    // AC
    { date: "2026-01-08", time: "19:45", label: "AC", short: "", icon: "AC", calendarTime: false },
    { date: "2026-01-22", time: "19:45", label: "AC", short: "", icon: "AC", calendarTime: false },
    { date: "2026-02-12", time: "19:45", label: "AC", short: "", icon: "AC", calendarTime: false },
    { date: "2026-02-26", time: "19:45", label: "AC", short: "", icon: "AC", calendarTime: false }
  ],

  // 週次のシフト (weekday: 0=日..6=土)
  // 例: { weekdays:[0,6], start:"13:00", end:"22:00", label:"シフトイン" }
  shifts: [
    { weekdays: [0, 2, 3, 6], start: "13:00", end: "22:00", label: "シフトイン", calendarColor: "rgba(110,168,255,0.20)" }
  ],
  garbage: [
    {
      type: "nthWeekday",
      weekday: 2,
      nth: [2, 4],
      label: "金属・陶器・ガラスごみ",
      short: "金属/陶/ガ",
      icon: "♻",
      url: "https://manage.delight-system.com/threeR/web/benri?menu=benri&jichitaiId=toshimaku&areaId=149898&benriCateId=%2f&bunbetsuCateId=%2f&faqCateId=%2f&lang=ja"
    },
    {
      type: "weekly",
      weekday: 5,
      label: "びん・かん・ペットボトル",
      short: "びん/かん/PET",
      icon: "♻",
      url: "https://manage.delight-system.com/threeR/web/benri?menu=benri&jichitaiId=toshimaku&areaId=149898&benriCateId=%2f&bunbetsuCateId=%2f&faqCateId=%2f&lang=ja"
    },
    {
      type: "weekly",
      weekday: 6,
      label: "段ボール・紙・布類・プラスチック",
      short: "紙/布/プラ",
      icon: "♻",
      url: "https://manage.delight-system.com/threeR/web/benri?menu=benri&jichitaiId=toshimaku&areaId=149898&benriCateId=%2f&bunbetsuCateId=%2f&faqCateId=%2f&lang=ja"
    }
  ]
};
