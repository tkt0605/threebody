// .env の読み込みだけを担う。index.ts の最初のimportにすること。
//
// ESMは静的importを「importする側の本体コードより先に」評価するため、index.ts本体で
// dotenv.config()を呼んでいても、その前にimportされた他モジュール（llm/modelConfig.ts等）
// が process.env を読むタイミングの方が早くなり、undefined を掴んでしまう
// （backend/supabaseAdmin.ts のコメントが警告している既知の罠と同じ）。
// このファイルを最初にimportし、他の全モジュールより先に確実に完了させる。
import dotenv from 'dotenv'

// backend/loadEnv.ts から見てリポジトリルートは1階層上
dotenv.config({ path: new URL('../.env', import.meta.url).pathname })
