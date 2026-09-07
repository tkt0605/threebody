import { createApp, h, nextTick, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversationBriefDialog from '../../components/ConversationBriefDialog.vue'
import TextComposer from '../../components/TextComposer.vue'
import { clearConversationBriefs, openConversationBrief, openNote, useConversationBrief } from '../useConversationBrief'

// jsdom は <dialog> の showModal / close を持たないので、open 属性の付け外しだけ真似る
beforeEach(() => {
  const proto = HTMLDialogElement.prototype
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  }
  if (typeof proto.close !== 'function') {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
})

let app: App | undefined
let host: HTMLDivElement
beforeEach(() => {
  clearConversationBriefs()
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  app?.unmount()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ダイアログは body へ Teleport されるので、host ではなく document から探す
function button(text: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(el => el.textContent?.includes(text))
  if (!result) throw new Error(`Button missing: ${text}`)
  return result
}
function field(label: string): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)
  if (!el) throw new Error(`Field missing: ${label}`)
  return el
}
function type(el: HTMLTextAreaElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('bodyノートのダイアログ', () => {
  it('マウントより先に開く要求が届いていても開く', async () => {
    openNote()
    app = createApp(ConversationBriefDialog, { busy: false })
    app.mount(host)
    await nextTick()
    expect(document.querySelector('dialog')!.open).toBe(true)
  })

  it('ファイルを読み込んでいる間に別会話へ移ったら追記しない', async () => {
    let finish!: (text: string) => void
    const pending = new Promise<string>(resolve => { finish = resolve })
    app = createApp(ConversationBriefDialog, { busy: false })
    app.mount(host)
    openNote()
    await nextTick()
    const input = document.querySelector<HTMLInputElement>('dialog input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [{ name: 'note.md', size: 20, text: () => pending }] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    openConversationBrief('another')
    finish('## 目的\n元の会話の目的')
    await nextTick()
    await nextTick()
    expect(useConversationBrief().brief.value.purpose).toBe('')
  })

  it.each([
    ['image.png', 10, 'Markdown'],
    ['large.md', 512 * 1024 + 1, '512KB'],
  ])('読み込めないファイル %s は内容を読まずに案内する', async (name, size, notice) => {
    const read = vi.fn()
    app = createApp(ConversationBriefDialog, { busy: false })
    app.mount(host)
    const input = document.querySelector<HTMLInputElement>('dialog input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [{ name, size, text: read }] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(read).not.toHaveBeenCalled()
    expect(document.querySelector('[role="status"]')?.textContent).toContain(notice)
  })

  it('連続して読み込むと、古い読み込みが遅れて完了しても混ぜない', async () => {
    let finish!: (text: string) => void
    const pending = new Promise<string>(resolve => { finish = resolve })
    app = createApp(ConversationBriefDialog, { busy: false })
    app.mount(host)
    const input = document.querySelector<HTMLInputElement>('dialog input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'first.md', size: 20, text: () => pending }] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    Object.defineProperty(input, 'files', { value: [{ name: 'second.md', size: 20, text: () => Promise.resolve('## 目的\n二つ目') }] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(useConversationBrief().brief.value.purpose).toBe('二つ目'))
    finish('## 目的\n一つ目')
    await nextTick()
    expect(useConversationBrief().brief.value.purpose).toBe('二つ目')
  })

  it('AppAside / AppHeader 側の openNote で開き、閉じると singleton も戻る', async () => {
    const { noteOpen } = useConversationBrief()
    app = createApp(ConversationBriefDialog, { busy: false })
    app.mount(host)
    const dialog = document.querySelector('dialog')!
    expect(dialog.open).toBe(false)
    openNote()
    await nextTick()
    expect(dialog.open).toBe(true)
    document.querySelector<HTMLButtonElement>('dialog button[aria-label="閉じる"]')!.click()
    await nextTick()
    expect(dialog.open).toBe(false)
    expect(noteOpen.value).toBe(false)
  })

  it('既存の下書きを残して追加し、本人が編集して送信するまで通信しない', async () => {
    const sent = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const composer = ref<{ appendText: (text: string) => void } | null>(null)
    app = createApp({
      setup: () => () => h('div', [
        h(ConversationBriefDialog, { busy: false, onPrepare: (text: string) => composer.value?.appendText(text) }),
        h(TextComposer, { ref: composer, initialText: '元の質問', onSend: sent }),
      ]),
    })
    app.mount(host)
    openNote()
    await nextTick()
    expect(button('入力欄に追加').disabled).toBe(true)
    type(field('目的'), '実験を決める')
    await nextTick()
    button('入力欄に追加').click()
    await nextTick()
    const area = host.querySelector<HTMLTextAreaElement>('#text-composer')!
    await vi.waitFor(() => expect(area.value).toMatch(/^元の質問\n\n# bodyノート/))
    expect(document.activeElement).toBe(area)
    expect(area.value).toContain('実験を決める')
    expect(sent).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    // 追加したらダイアログは閉じ、入力欄へ戻る
    expect(useConversationBrief().noteOpen.value).toBe(false)
    type(area, '編集した相談だけを送る')
    await nextTick()
    host.querySelector<HTMLButtonElement>('[aria-label="送信"]')!.click()
    expect(sent).toHaveBeenCalledExactlyOnceWith('編集した相談だけを送る')
  })

  it('録音・生成中は追加を止め、入力欄自体もreadonly/disabled中の追加を拒否する', async () => {
    const prepare = vi.fn()
    const composer = ref<{ appendText: (text: string) => void } | null>(null)
    const readonly = ref(true)
    const disabled = ref(false)
    useConversationBrief().brief.value.purpose = '目的'
    app = createApp({ setup: () => () => h('div', [
      h(ConversationBriefDialog, { busy: true, onPrepare: prepare }),
      h(TextComposer, { ref: composer, readonly: readonly.value, disabled: disabled.value, displayText: '認識中' }),
    ]) })
    app.mount(host)
    button('入力欄に追加').click()
    expect(prepare).not.toHaveBeenCalled()
    composer.value?.appendText('差し込み')
    await nextTick()
    expect(host.querySelector<HTMLTextAreaElement>('#text-composer')!.value).toBe('認識中')
    readonly.value = false
    disabled.value = true
    await nextTick()
    composer.value?.appendText('差し込み')
    await nextTick()
    expect(host.querySelector<HTMLTextAreaElement>('#text-composer')!.value).toBe('')
  })

  it('進捗はユーザーの選択で変わり、Markdownを保存できる', async () => {
    const createUrl = vi.fn((_blob: Blob) => 'blob:note')
    vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    useConversationBrief().brief.value.purpose = '目的'
    app = createApp(ConversationBriefDialog, { busy: false })
    app.mount(host)
    const select = document.querySelector('dialog select')!
    ;(select as HTMLSelectElement).value = 'done'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(useConversationBrief().brief.value.progress).toBe('done')
    button('ダウンロード').click()
    expect(createUrl).toHaveBeenCalledOnce()
    expect(createUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledOnce()
  })

  it('自作のMarkdownを読み込むと、欄に振り分けて既存の内容へ追記し、通信しない', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { brief } = useConversationBrief()
    brief.value.purpose = '先に書いた目的'
    app = createApp(ConversationBriefDialog, { busy: false })
    app.mount(host)
    const input = document.querySelector<HTMLInputElement>('dialog input[type="file"]')!
    const file = new File(['# 自分のメモ\n\n## 目的\n読み込んだ目的\n\n## 参考\nリンク集\n'], 'note.md', { type: 'text/markdown' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(brief.value.purpose).toBe('先に書いた目的\n\n読み込んだ目的'))
    expect(brief.value.material).toBe('## 参考\nリンク集')
    expect(document.querySelector('dialog [role="status"]')?.textContent).toContain('note.md')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
