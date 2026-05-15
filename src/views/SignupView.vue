<script setup lang="ts">
import { ref, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as faceapi from 'face-api.js'
import { supabase } from '../lib/supabase'
import { useFaceAuth } from '../composables/useFaceAuth'
import { useLiveness } from '../composables/useLiveness'
import ThreeBodyLogo from '../components/ThreeBodyLogo.vue'

type Phase = 'email' | 'otp' | 'face' | 'done'

const router  = useRouter()
const phase   = ref<Phase>('email')
const email   = ref('')
const otp     = ref('')
const error   = ref('')
const loading = ref(false)
const status  = ref('')

const videoRef = ref<HTMLVideoElement | null>(null)
let stream:  MediaStream | null = null
let timerId: ReturnType<typeof setInterval> | null = null
let registered = false

const { loadModels, registerFace, linkFace } = useFaceAuth()
const { init: initLiveness, currentLabel, progress, completed: livenessOK, processFace } = useLiveness()

// ── Phase 1 → OTP ────────────────────────────────────────────────────────
async function toOtpPhase() {
  if (!email.value.trim()) { error.value = 'メールアドレスを入力してください'; return }
  error.value   = ''
  loading.value = true

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email: email.value.trim(),
    options: { shouldCreateUser: true },
  })
  if (otpError) { error.value = otpError.message; loading.value = false; return }

  loading.value = false
  phase.value   = 'otp'
}

// ── Phase OTP → Face ──────────────────────────────────────────────────────
async function verifyOtpAndProceed() {
  if (otp.value.trim().length !== 6) { error.value = '6桁のコードを入力してください'; return }
  error.value   = ''
  loading.value = true

  const { error: err } = await supabase.auth.verifyOtp({
    email: email.value.trim(),
    token: otp.value.trim(),
    type:  'email',
  })
  if (err) { error.value = err.message; loading.value = false; return }

  // 認証完了 → 顔登録フェーズへ
  loading.value = false
  phase.value   = 'face'
  startFaceSetup()
}

// ── Face Setup ────────────────────────────────────────────────────────────
async function startFaceSetup() {
  loading.value  = true
  registered     = false
  status.value   = 'AIモデルを読み込んでいます...'

  try {
    await loadModels()
    initLiveness()

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 },
    })
    await nextTick()
    videoRef.value!.srcObject = stream
    await videoRef.value!.play()
    status.value  = ''
    loading.value = false
    startDetection()
  } catch (e) {
    error.value   = e instanceof Error ? e.message : 'カメラの起動に失敗しました'
    loading.value = false
  }
}

function startDetection() {
  timerId = setInterval(async () => {
    if (!videoRef.value || phase.value !== 'face') return

    let result
    try {
      result = await faceapi
        .detectSingleFace(videoRef.value, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor() ?? null
    } catch { result = null }

    if (!result) return

    if (!livenessOK.value) {
      processFace(result.landmarks)
      return
    }

    // チャレンジ通過後、顔を登録
    if (!registered) {
      registered    = true
      stopDetection()
      status.value  = '顔を登録しています...'
      loading.value = true

      try {
        const descriptor = Array.from(result.descriptor) as number[]
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('ユーザー情報の取得に失敗しました')

        await registerFace(email.value.trim(), descriptor)
        await linkFace(email.value.trim(), user.id)

        phase.value   = 'done'
        loading.value = false
        stopCamera()
        setTimeout(() => router.push('/'), 1200)
      } catch (e) {
        error.value   = e instanceof Error ? e.message : '顔の登録中にエラーが発生しました'
        loading.value = false
        registered    = false
        initLiveness()
        startDetection()
      }
    }
  }, 150)
}

function stopDetection() {
  if (timerId) { clearInterval(timerId); timerId = null }
}

function stopCamera() {
  stopDetection()
  stream?.getTracks().forEach(t => t.stop())
  stream = null
}

onUnmounted(stopCamera)
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-gray-950">
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/8 rounded-full blur-3xl" />
    </div>

    <div class="relative w-full max-w-sm px-4">
      <div class="flex flex-col items-center mb-10 gap-3">
        <ThreeBodyLogo class="scale-125" />
        <span class="text-white/80 font-semibold tracking-widest text-sm">ThreeBody</span>
      </div>

      <!-- Phase 1: Email -->
      <div v-if="phase === 'email'" class="bg-gray-900 border border-white/8 rounded-2xl p-8 shadow-2xl space-y-5">
        <h1 class="text-white/90 font-semibold text-base text-center">アカウント作成</h1>
        <p class="text-xs text-white/35 text-center">パスワードの代わりに顔で認証します</p>

        <div class="space-y-1.5">
          <label class="text-[11px] text-white/40 uppercase tracking-widest">メールアドレス</label>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            class="w-full rounded-xl bg-white/5 border border-white/8 text-sm text-white/90 placeholder-white/20 px-4 py-2.5 outline-none focus:border-indigo-500/60 transition-colors"
            @keydown.enter="toOtpPhase"
          />
        </div>

        <p v-if="error" class="text-xs text-rose-400/90 text-center bg-rose-500/8 border border-rose-500/15 rounded-lg px-3 py-2">
          {{ error }}
        </p>

        <button
          class="w-full py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2"
          :class="loading
            ? 'bg-indigo-700/50 text-white/40 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white'"
          :disabled="loading"
          @click="toOtpPhase"
        >
          <svg v-if="loading" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
          </svg>
          {{ loading ? '送信中...' : '次へ' }}
        </button>

        <p class="text-center text-xs text-white/35">
          すでにアカウントをお持ちの方は
          <RouterLink to="/login" class="text-indigo-400 hover:text-indigo-300 transition-colors">ログイン</RouterLink>
        </p>
      </div>

      <!-- Phase OTP -->
      <div v-if="phase === 'otp'" class="bg-gray-900 border border-white/8 rounded-2xl p-8 shadow-2xl space-y-5">
        <div class="w-12 h-12 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto">
          <svg class="w-6 h-6 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="22,6 12,13 2,6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="text-white/90 font-semibold text-base text-center">メール確認</h1>
        <p class="text-xs text-white/40 text-center leading-relaxed">
          <span class="text-white/65">{{ email }}</span><br>に送信した6桁のコードを入力してください
        </p>

        <div class="space-y-1.5">
          <label class="text-[11px] text-white/40 uppercase tracking-widest">確認コード</label>
          <input
            v-model="otp"
            type="text"
            inputmode="numeric"
            maxlength="6"
            placeholder="000000"
            class="w-full rounded-xl bg-white/5 border border-white/8 text-base text-white/90 placeholder-white/20 px-4 py-2.5 outline-none focus:border-indigo-500/60 transition-colors text-center tracking-[0.35em]"
            @keydown.enter="verifyOtpAndProceed"
          />
        </div>

        <p v-if="error" class="text-xs text-rose-400/90 text-center bg-rose-500/8 border border-rose-500/15 rounded-lg px-3 py-2">
          {{ error }}
        </p>

        <button
          class="w-full py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2"
          :class="loading
            ? 'bg-indigo-700/50 text-white/40 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white'"
          :disabled="loading"
          @click="verifyOtpAndProceed"
        >
          <svg v-if="loading" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
          </svg>
          {{ loading ? '確認中...' : '確認する' }}
        </button>
      </div>

      <!-- Phase Face Registration -->
      <div v-if="phase === 'face'" class="bg-gray-900 border border-white/8 rounded-2xl p-6 shadow-2xl space-y-4">
        <h1 class="text-white/90 font-semibold text-base text-center">顔を登録</h1>
        <p class="text-xs text-white/35 text-center">次回からこの顔でログインできます</p>

        <div v-if="status || loading" class="flex items-center justify-center gap-2 text-sm text-white/50 py-1">
          <svg class="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
          </svg>
          <span>{{ status || '登録中...' }}</span>
        </div>

        <div class="relative rounded-xl overflow-hidden bg-black" style="aspect-ratio:4/3">
          <video
            ref="videoRef"
            class="w-full h-full object-cover"
            style="transform: scaleX(-1)"
            muted
            playsinline
          />
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              class="w-44 h-52 rounded-full border-2 transition-colors"
              :class="livenessOK ? 'border-green-400/80' : 'border-indigo-400/70'"
              style="box-shadow: 0 0 0 9999px rgba(0,0,0,0.4)"
            />
          </div>
        </div>

        <div v-if="!loading && currentLabel" class="text-center space-y-1">
          <p class="text-[11px] text-white/35 uppercase tracking-widest">チャレンジ {{ progress }}</p>
          <p class="text-white/85 font-medium text-sm">{{ currentLabel }}</p>
        </div>

        <p v-if="error" class="text-xs text-rose-400/90 text-center bg-rose-500/8 border border-rose-500/15 rounded-lg px-3 py-2">
          {{ error }}
        </p>
      </div>

      <!-- Phase Done -->
      <div v-if="phase === 'done'" class="bg-gray-900 border border-white/8 rounded-2xl p-12 shadow-2xl flex flex-col items-center gap-4">
        <div class="w-14 h-14 rounded-full bg-green-600/20 border border-green-500/30 flex items-center justify-center">
          <svg class="w-7 h-7 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="20,6 9,17 4,12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <p class="text-white/80 font-medium">登録完了</p>
        <p class="text-xs text-white/35">次回から顔でログインできます</p>
      </div>
    </div>
  </div>
</template>
