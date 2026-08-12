// Markdown記法を「声で読み上げる／スクリーンリーダーが読む」ためのプレーンテキストにする。
// TTS（useTTS）とライブリージョン（ChatLiveRegion）の両方が同じ変換を必要とするため、
// どちらのcomposableにも属さない純関数としてここに置く
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')          // コードブロック
    .replace(/`([^`]+)`/g, '$1')             // インラインコード
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 画像
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // リンク
    .replace(/^#{1,6}\s+/gm, '')             // 見出し
    .replace(/\*\*([^*]+)\*\*/g, '$1')       // 太字(**)
    .replace(/__([^_]+)__/g, '$1')           // 太字(__)
    .replace(/\*([^*]+)\*/g, '$1')           // 斜体(*)
    .replace(/_([^_]+)_/g, '$1')             // 斜体(_)
    .replace(/^\s*[-*+]\s+/gm, '')           // 箇条書き記号
    .replace(/^\s*\d+\.\s+/gm, '')           // 番号付きリスト記号
    .replace(/^>\s+/gm, '')                  // 引用
    .trim()
}
