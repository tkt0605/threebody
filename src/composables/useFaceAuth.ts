import { ref } from 'vue'
import type * as FaceApi from 'face-api.js'

const MODEL_URL = '/models'
const API_BASE  = import.meta.env.VITE_API_BASE_URL as string

const modelsLoaded = ref(false)
let loadPromise: Promise<void> | null = null
let faceapi: typeof FaceApi | null = null

export function useFaceAuth() {
  async function loadModels(): Promise<void> {
    if (modelsLoaded.value) return
    if (loadPromise) { await loadPromise; return }
    loadPromise = (async () => {
      faceapi = await import('face-api.js')
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ])
      modelsLoaded.value = true
    })()
    await loadPromise
  }

  async function extractDescriptor(video: HTMLVideoElement): Promise<Float32Array | null> {
    if (!faceapi) return null
    const result = await faceapi
      .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor()
    return result?.descriptor ?? null
  }

  async function registerFace(email: string, descriptor: number[]): Promise<void> {
    const res = await fetch(`${API_BASE}/api/auth/face/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, descriptor }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { error?: string }).error ?? '顔の登録に失敗しました')
    }
  }

  async function verifyFace(email: string, descriptor: number[]): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/auth/face/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, descriptor }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { error?: string }).error ?? '顔の確認に失敗しました')
    }
    const { match } = await res.json() as { match: boolean }
    return match
  }

  async function linkFace(email: string, userId: string): Promise<void> {
    await fetch(`${API_BASE}/api/auth/face/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, userId }),
    })
  }

  return { modelsLoaded, loadModels, extractDescriptor, registerFace, verifyFace, linkFace }
}
