<script setup lang="ts">
import { useRouter } from 'vue-router'
import ThreeBodyLogo from '../components/ThreeBodyLogo.vue'
import { useTheme } from '../composables/useTheme'

// 操作方法・検算の詳細・トラブル時（/help）。/ と違い「登録」ではなく「迷わせないこと」が
// 目的なので、CTAは置かない。中からはサイドバーの「使い方」からリンクする
//
// ログイン前（LoginView の「使い方を見る」）からも開かれるため、ヘッダの構成は
// LegalPage / LandingView と揃える（戻る導線＋テーマ切替）
const router = useRouter()
const { isDark, toggle } = useTheme()

function goBack() {
  if (window.history.state?.back) router.back()
  else router.push('/')
}
</script>

<template>
  <div class="relative min-h-dvh bg-gray-50 dark:bg-gray-950 overflow-x-hidden">
    <!-- 装飾。新色は増やさず、既存のブランド色（indigo）だけで奥行きを作る -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] bg-indigo-600/10 dark:bg-indigo-500/10 rounded-full blur-3xl" />
      <div class="absolute top-64 -right-24 w-72 h-72 bg-indigo-400/10 dark:bg-indigo-400/8 rounded-full blur-3xl" />
    </div>

    <header class="sticky top-0 z-10 border-b border-black/8 dark:border-white/8 bg-gray-50/80 dark:bg-gray-950/80 backdrop-blur-md">
      <div class="max-w-3xl mx-auto flex items-center gap-3 px-5 py-3">
        <button
          class="shrink-0 p-1.5 -ml-1.5 rounded-lg cursor-pointer transition-colors
                 text-gray-500 hover:bg-gray-200/70 dark:text-white/50 dark:hover:bg-white/8"
          title="戻る"
          aria-label="戻る"
          @click="goBack"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <ThreeBodyLogo />
        <span class="text-gray-900 dark:text-white/90 font-semibold tracking-wide text-sm">ThreeBody</span>

        <button
          class="ml-auto w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer
                 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60
                 dark:text-white/40 dark:hover:text-white/80 dark:hover:bg-white/8"
          :title="isDark ? 'ライトモードに切替' : 'ダークモードに切替'"
          @click="toggle"
        >
          <svg v-if="isDark" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke-linecap="round"/>
          </svg>
          <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </header>

    <main class="relative max-w-3xl mx-auto px-5 py-12 space-y-6">
      <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">使い方</h1>

      <section class="rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-5 space-y-2 transition-colors hover:border-indigo-500/30">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z"/>
              <path d="M19 11a7 7 0 01-14 0M12 19v3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">声で話す</h2>
        </div>
        <ul class="space-y-1.5 text-sm leading-relaxed text-gray-600 dark:text-white/60 list-disc pl-5">
          <li>球体をタップすると録音が始まります。初回だけマイクの許可を求められます。</li>
          <li>話し終えて無音になると自動で送信されます。待ち時間は言い方で変わり、「〜です」のように言い切った直後は短く、「〜だけど」のように続きそうな言い回しのあとは長めに待ちます。</li>
          <li>しばらく操作が無いとマイクは自動的に切れます。再開するときは球体をもう一度タップしてください。</li>
        </ul>
      </section>

      <section class="rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-5 space-y-2 transition-colors hover:border-indigo-500/30">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 4h16v12H8l-4 4V4z" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 9h8M8 12h5" stroke-linecap="round"/>
            </svg>
          </div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">文字で話す</h2>
        </div>
        <ul class="space-y-1.5 text-sm leading-relaxed text-gray-600 dark:text-white/60 list-disc pl-5">
          <li>マイクを使いたくない場面や、音声認識に対応していないブラウザでは、下の入力欄から文字で送れます。</li>
          <li>文字で送った問いには、読み上げは付きません。</li>
        </ul>
      </section>

      <section class="rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-5 space-y-2 transition-colors hover:border-indigo-500/30">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="9"/>
              <path d="M8.5 12.5l2.5 2.5 5-5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">検算が付く条件</h2>
        </div>
        <p class="text-sm leading-relaxed text-gray-600 dark:text-white/60">
          検算は、次の条件をすべて満たしたときだけ付きます。
        </p>
        <ul class="space-y-1.5 text-sm leading-relaxed text-gray-600 dark:text-white/60 list-disc pl-5">
          <li>設定で2体目・3体目（副体）が設定されていること</li>
          <li>挨拶や一言だけの質問ではなく、割れる余地のある問いであること</li>
          <li>主体の答えが、ある程度の長さ（目安120字程度）になったこと</li>
        </ul>
      </section>

      <section class="rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-5 space-y-2 transition-colors hover:border-indigo-500/30">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M12 4l8 15H4L12 4z" stroke-linejoin="round"/>
              <circle cx="12" cy="14.2" r="1.1" fill="currentColor" stroke="none"/>
            </svg>
          </div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">体の概念</h2>
        </div>
        <p class="text-sm leading-relaxed text-gray-600 dark:text-white/60">
          ThreeBody は LLM を「体」と呼びます。主体が1体、検算する副体が最大2体です。
        </p>
        <ul class="space-y-1.5 text-sm leading-relaxed text-gray-600 dark:text-white/60 list-disc pl-5">
          <li>主体は他の体の存在を知らされず、単体のときと同じ問いに同じように答えます。</li>
          <li>副体は、主体が答え終わったあとにその答えを読み、指摘を1つだけ書きます。見るところは体ごとに違い、「崩れる点」「抜けている点」「別の見方」に分かれます。</li>
          <li>指摘が無ければ「指摘なし」のままカードは表示されません。副体の呼び出しが失敗しても、主体の答えは揺らぎません。カードが1枚欠けるだけです。</li>
        </ul>
      </section>

      <section class="rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-5 space-y-2 transition-colors hover:border-indigo-500/30">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M3 12a9 9 0 1 0 3-6.7" stroke-linecap="round"/>
              <path d="M3 4v5h5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12 8v4l3 2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">検算方式にした経緯</h2>
        </div>
        <p class="text-sm leading-relaxed text-gray-600 dark:text-white/60">
          以前は副体の見解を主体のプロンプトへ注入し、1つの答えへ統合する方式でした。測定した結果、
          他の体から主体に伝わった観点は平均0.1件/回にとどまり、単体でなら出ていたはずの観点が
          平均1.2件/回失われていました。今は主体が単体のときと同じ条件で先に答え、副体があとから
          検算する方式に変えています。
        </p>
      </section>

      <section class="rounded-2xl border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] backdrop-blur-sm p-5 space-y-2 transition-colors hover:border-indigo-500/30">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="9"/>
              <circle cx="12" cy="12" r="4"/>
              <path d="M4.9 4.9l4.2 4.2M19.1 4.9l-4.2 4.2M4.9 19.1l4.2-4.2M19.1 19.1l-4.2-4.2" stroke-linecap="round"/>
            </svg>
          </div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">困ったとき</h2>
        </div>
        <ul class="space-y-1.5 text-sm leading-relaxed text-gray-600 dark:text-white/60 list-disc pl-5">
          <li>マイクが使えない・許可を拒否した場合は、下の文字入力から同じように使えます。</li>
          <li>応答が途中で止まった、または届かなかった場合は、そのメッセージに出る「話し直す」「編集して送る」「削除する」から、やり直すか消すかを選べます。</li>
        </ul>
      </section>
    </main>
  </div>
</template>
