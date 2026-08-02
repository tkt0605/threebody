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

// 正規表現をしようしない。

function redactString(text: string, secrets: readonly string []): string{
    return secrets.reduce((acc, secret) => acc.split(secret).join(MASK), text)
}

// 文字列から匿名値を伏せ字にする。
export function redactText(text: string, secrets: readonly string []): string{
    const list = normalizeSecret(secrets)
    return list.length > 0 ? redactString(text, list): text
}

// オブジェクト・配列を再帰的にたどり、全ての文字列を匿名値を伏せ字化する。
export function redactDeep<T>(value: T, secrets: readonly string []): T{
    const list = normalizeSecret(secrets)
    return list.length === 0 ? value : (walk(value, list) as T)
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

export function containsSecret(value: unknown, secrets: readonly string[]): boolean{
    const list = normalizeSecret(secrets)
    if (list.length === 0)return false
    // undefined や関数を渡すと JSON.stringify は undefined を返すため、空文字に倒す
    const json = JSON.stringify(value) ?? ''
    return list.some(secret => json.includes(secret))
}