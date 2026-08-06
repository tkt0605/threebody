// 共有APIキーの「1日」の境界は日本時間(JST, UTC+9)の0時。
// サーバーはUTCで動くため、日付判定は必ずUTC時刻をJSTに変換してから行う。
//
// 素直に見える書き方が2つあるが、どちらも使えない:
//
//   new Date().toISOString().slice(0, 10)
//     → UTCの日付が返る。JST 9:00 は UTC で前日 24:00 なので、毎日朝9時までが前日扱いになる
//
//   now.toLocaleDateString('ja-JP')
//     → サーバーのTZ設定に依存する。手元(JST)では完璧に動き、Render(UTC)でだけ壊れる。
//       開発中に一切症状が出ないため、最も見つけにくい壊れ方をする
//
// 下の実装が成立する理由:
//   1. getTime() は1970年からの絶対ミリ秒。TZ設定に影響されない
//   2. そこに9時間分を足す
//   3. toISOString() は常にUTC表記で返す。これもTZ設定に影響されない
//   4. 「絶対時刻 + 9h を UTC として読む」＝「JSTのカレンダー日付」
// TZ非依存の関数だけで組み立てているので、サーバーのTZ設定が何であっても同じ答えが出る。
// 日本にサマータイムは無いため、固定オフセットで正確。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// JSTでの暦日を 'YYYY-MM-DD' で返す。user_setting.shared_last_used_date は date 型なので
// この文字列がそのまま入る。
// 割当の判定（この日付と比較してカウントをリセットするか決める）と、消費後の保存の
// 両方で必ずこの関数を呼ぶこと。片方だけ別の計算にすると日跨ぎで不整合が出る。
export function jstDateString(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}
