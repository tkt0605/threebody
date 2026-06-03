# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

ThreeBodyは、マルチモーダルAI体験を探求するプロトタイプです。1〜3つのLLMノード（「体」）を三角形に配置し、その重心で音声チャットを行います。複数のLLMが並列に回答し、主体（一体）が統合する「三体モード」が中心機能です。

## 開発コマンド

```bash
# フロントエンドのみ（Vite dev server, port 5173）
npm run dev

# バックエンドのみ（Express server, port 3000）
npm run dev:server

# 両方同時起動（通常の開発はこれ）
npm run dev:all
```

ビルドコマンド・テストコマンドは現在未設定。型チェックは `vue-tsc` で行える（`npx vue-tsc --noEmit`）。

## アーキテクチャ

### フロントエンド (`src/`)
- **Vue 3 Composition API** + TypeScript + Tailwind CSS v4
- **ルーティング**: `src/router/index.ts` — `/`（要認証）、`/login`、`/signup`、`/auth/callback`
- **認証**: Supabase Auth (PKCE フロー) + 顔認証（face-api.js）

### バックエンド (`backend/src/server.ts`)
- **単一ファイル** の Express サーバー
- SSE（Server-Sent Events）形式でストリーミングレスポンスを返す
- モデル設定は `.env` の環境変数で管理（コードは変更不要）

### 状態管理パターン
Composables はモジュールレベルのシングルトンとして設計されており、コンポーネント間で状態を共有する：
- `useChat.ts` — `messages` を module-level `ref` として保持
- `useTriangleNodes.ts` — `placedNodes` を module-level `ref` として保持
- `useSettings.ts` — `settings` を `reactive` として保持し、`localStorage` に自動永続化

### メッセージのブロック構造
`src/types/message.ts` で定義。各メッセージは `blocks: ContentBlock[]` を持つ（現在は `text` と `error` のみ実装。`image`・`map`・`game` は将来用）。

### 三体モード（マルチLLM）
`/api/chat` が `bodies` 配列を受け取ると三体モードになる：
1. 副体（二体・三体）に並列でリクエスト（最大 512 トークン）
2. 各副体の見解をシステムプロンプトに注入
3. 主体（一体）が統合回答をストリーミング出力

### 思考レベル（1〜5）
`LEVEL_CONFIG` でモデルとトークン上限をマッピング：
- Level 1-2: Fast モデル（Haiku / gpt-4o-mini）
- Level 3: Balanced モデル（Sonnet / gpt-4o）
- Level 4: Balanced + thinking（thinkingBudget: 8000）
- Level 5: Powerful + adaptive thinking（Opus / o3）

### APIエンドポイント
| エンドポイント | 説明 |
|---|---|
| `POST /api/chat` | SSEチャット（三体モード対応） |
| `GET /api/health` | ヘルスチェック |
| `POST /api/auth/face/register` | 顔特徴量登録 |
| `POST /api/auth/face/verify` | 顔照合 |
| `POST /api/auth/face/login` | 顔認証ログイン（magic link 発行） |
| `POST /api/auth/face/signup` | 顔認証サインアップ |
| `POST /api/scenes` | 青空文庫テキストからシーン生成 |

## 環境変数 (`.env`)

フロントエンド（`VITE_` プレフィックス）とバックエンド両方の変数が同一ファイルに存在する。

- **モデル更新**: `ANTHROPIC_MODEL_FAST/BALANCED/POWERFUL` などの変数を書き換えるだけでモデル変更可能
- `VITE_API_BASE_URL`: バックエンドのURL（デフォルト `http://localhost:3000`）
- `VITE_ORIGIN_BASE_URL`: フロントエンドのURL（CORSに使用）
- `SUPABASE_SERVICE_KEY`: バックエンドのみで使用（RLSバイパス用）

## 主要コンポーネント

- `AppAside.vue` — 左サイドバー（三角形のNode配置UI）
- `AppRightSidebar.vue` — 右サイドバー（テキスト入力・音声UI）
- `NodeCanvas.vue` — 三角形のドラッグ配置キャンバス
- `SettingsDialog.vue` — 設定（プロバイダー・モデル・三体設定）
- `ContextDialog.vue` — コンテキスト管理
- `McpDialog.vue` / `McpPanel.vue` — MCPサーバー管理

## 音声機能

- `useVoiceInput.ts` — Web Speech API で音声認識、コールバックで送信
- `useWakeWord.ts` — 「アイリス」でウェイクワード検知 → 録音開始
- `useTTS.ts` — SpeechSynthesis API でAI応答を読み上げ
- `useLiveness.ts` / `useFaceAuth.ts` — face-api.js による顔検出・認証

録音中はウェイクワード検知を停止し、同一マイクの競合を防ぐ（`ChatView.vue:37-42`）。
