// APIキーなどの完全匿名希望の値を送信・保存・表示の前に伏字で置き換える。
//
// 一段目は「手元にある実値そのもの」を探す方式。プロバイダーが将来数多くのものになり、
// どんな形式のAPIキーを発行したとしても篩にかけられるようにするため。
// 二段目はパターン照合。一段目は以下の2つを取りこぼすので、その受け皿として置く。
//   - 手元に無いキー（バックエンドの環境変数側のキーがエラー本文に混ざって返ってきた場合など）
//   - 実値が変形して返ってきた場合（OpenAIは "sk-dummy*************cdef" のようにマスクして返す）

const MASK = '[APP_REDACTED]';

// 短いものまで、匿名値としてしまうと一般的な文章の英単語にも影響をきたす。
// また、実際のAPIキーはかなり長い。故に、8文字未満は非対称

const MIN_SECRET_LENGTH = 8;

function normalizeSecret(secrets: readonly string[]): string[]{
    const cleaned = secrets
        .map(s => s.trim())
        .filter(s => s.length >= MIN_SECRET_LENGTH)
    //　一方が他方に含まれる場合、長い方を優先するため、長い順にソートしてからSetで重複排除する
    return [...new Set(cleaned)].sort((a, b) => b.length - a.length)
}

// 二段目で使うパターン。キーらしい見た目の塊を、実値を知らなくても伏せ字にする。
// マスク済みの形（sk-dummy*************cdef）を拾うため、文字クラスに * を含めているのが要点。
// /g 付き正規表現は lastIndex を持ち越して結果が変わるため、ソースだけ持ち使う直前に組み立てる
const KEY_PATTERNS: readonly { source: string; flags: string }[] = [
    // OpenAI / DeepSeek / Anthropic（sk-ant-... もここに含まれる）
    { source: 'sk-[A-Za-z0-9_*-]{6,}', flags: 'g' },
    // Authorization ヘッダごとエコーバックされた場合
    { source: 'Bearer\\s+[A-Za-z0-9._~+/=*-]{8,}', flags: 'gi' },
    // x-api-key: xxxxx のようなヘッダ表記
    { source: 'x-api-key["\'\\s:=]+[A-Za-z0-9._*-]{8,}', flags: 'gi' },
]

// 一段目→二段目の順に通す。逆にすると、伏せ字化された箇所を実値照合が見失う。
// 一段目は正規表現を使わないので、記号を含むキーでも壊れずに消せる（こちらが本命）
function redactString(text: string, secrets: readonly string []): string{
    const exact = secrets.reduce((acc, secret) => acc.split(secret).join(MASK), text)
    return KEY_PATTERNS.reduce(
        (acc, { source, flags }) => acc.replace(new RegExp(source, flags), MASK),
        exact,
    )
}

// 文字列から匿名値を伏せ字にする。
// 秘匿値が手元に1つも無くても二段目は働かせる。手元に無いキーこそ二段目の担当のため
// （バックエンドの環境変数のキー、報告ボタンを押す前に設定から消されたキーなど）
export function redactText(text: string, secrets: readonly string [] = []): string{
    return redactString(text, normalizeSecret(secrets))
}

// オブジェクト・配列を再帰的にたどり、全ての文字列を匿名値を伏せ字化する。
export function redactDeep<T>(value: T, secrets: readonly string [] = []): T{
    return walk(value, normalizeSecret(secrets)) as T
}

function walk(value: unknown, secrets: readonly string []): unknown{
    if (typeof value === 'string') return redactString(value, secrets)
    if (Array.isArray(value)) return value.map(v => walk(v, secrets))
    if (value instanceof Date) return value
    if (value !== null && typeof value === 'object'){
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, walk(v, secrets)])
        )
    }
    return value
}

// 伏せ字が隠れていないのかを検査用。
// 判定を自前で書かず「伏せ字化して変化したか」で見る。redactString と同じ経路を通るので、
// 網（一段目・二段目）を足しても検査側が古いまま取り残されることがない
export function containsSecret(value: unknown, secrets: readonly string[] = []): boolean{
    // undefined や関数を渡すと JSON.stringify は undefined を返すため、空文字に倒す
    const json = JSON.stringify(value) ?? ''
    return redactString(json, normalizeSecret(secrets)) !== json
}