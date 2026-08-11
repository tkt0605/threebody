# Three Body
[![Live Demo](https://img.shields.io/badge/demo-threebody--phi.vercel.app-000?logo=vercel)](https://threebody-phi.vercel.app)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Last commit](https://img.shields.io/github/last-commit/tkt0605/threebody.svg)](https://github.com/tkt0605/threebody/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/tkt0605/threebody.svg?style=social)](https://github.com/tkt0605/threebody/stargazers)

**Japanese/日本語**・[English/英語](README.en.md)

> 3つのモデルが並列で考え、球体がその思考を可視化する。 
> LLM APIまたは、OllamaのローカルLLMのモデルを自由に組み合わせられる。
> 声で話しかけ、声で会話が完結する。

![threebody_demo_20260729](threebody_demo_20260729.gif)

# 今すぐ試す
https://threebody-phi.vercel.app

Google認証でログイン後、設定画面でLLM APIキーを入力すればすぐに使える。

> [!NOTE]
> ホスト版ではOllamaは選べない。サーバーから各自のローカルPCで動くOllamaへは到達できないため。
> Ollamaを使うには下の「クイック・スタート」でローカル実行する。

## 対応プロバイダー
| プロバイダー | APIキー | 備考 |
|---|---|---|
| Anthropic (Claude) | 必要 | |
| OpenAI (ChatGPT) | 必要 | |
| DeepSeek | 必要 | OpenAI互換エンドポイントとして扱う |
| Ollama | 不要 | ローカル実行時のみ |

## LLM APIキーの取得方法
1. OpenAI, Anthropic, DeepSeek各社のAPIコンソールにアクセス
2. 各自のアカウントを作成・ログイン
3. **Create API key** をクリック
4. このアプリの`設定ボタン`の詳細設定から取得したAPI Keyと利用するLLMモデルを貼り付ける。

## 無料お試し枠について
自分のAPIキーを持たないユーザー向けに、運営のキーで**1日3回**まで三体モードを試せる枠がある。
Googleログインすればそのまま使えるが、運営が負担するトークンコストを抑えるため
思考レベルは2に固定され、**サービス全体でも1日50回**の上限がある
（全体の枠を使い切った場合は、翌日まで待つか自分のAPIキーを登録する）。

## これはどんなものか？ 
従来のものは、モデルもUIも固定である。
しかし、Threebodyは違う。Ollama・ChatGPT・Claude・DeepSeekを
自由に組み合わせ、３つの視点から物事を推論させ、答えを導く。
## 　クイック・スタート
以下は、Githubからのディレクトリをクローンしてから依存関係をインストール。
`.env`を新規作成し、自身が取得したAPIキーを`.env`に追加してください。
```bash
git clone https://github.com/tkt0605/threebody
cd threebody
npm install
npm run dev:all
```