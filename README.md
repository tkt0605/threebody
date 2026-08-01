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

## LLM APIキーの取得方法
1. OpenAPI, Anthropic, Google各社のAPIコンソールにアクセス
2. 各自のアカウントを作成・ログイン
3. **Create API key** をクリック
4. このアプリの`設定ボタン`の詳細設定から取得したAPI Keyと利用するLLMモデルを貼り付ける。

## これはどんなものか？ 
従来のものは、モデルもUIも固定である。
しかし、Threebodyは違う。Ollama・chatCPT・Claude・Gemini・Deepseekを
自由に組み合わせ、３つの視点から物事を推論させ、答えを導く。
## 　クイック・スタート
以下は、Githubからのディレクトリをクローンしてから依存関係をインストール。
```bash
git clone https://github.com/tkt0605/threebody
cd threebody
npm install
npm run dev:all
```