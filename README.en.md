# Three Body

[![Live Demo](https://img.shields.io/badge/demo-threebody--phi.vercel.app-000?logo=vercel)](https://threebody-phi.vercel.app)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Last commit](https://img.shields.io/github/last-commit/tkt0605/threebody.svg)](https://github.com/tkt0605/threebody/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/tkt0605/threebody.svg?style=social)](https://github.com/tkt0605/threebody/stargazers)

**English/英語**・[Japanese/日本語](README.md)

> Three models process information in parallel, and a sphere visualizes their reasoning.
> You can freely combine LLM APIs or local LLM models via Ollama.
> Interact entirely through voice—from the initial prompt to the final conversation.

![threebody_demo_20260729](threebody_demo_20260729.gif)

# Try it now
https://threebody-phi.vercel.app

Log in using Google authentication, enter your LLM API key in the settings screen, and you're ready to go.

## How to get an LLM API key
1. Visit the API consoles for OpenAI, Anthropic, or Google.
2. Create an account and log in.
3. Click **Create API key**.
4. Paste the obtained API key and select the LLM model you wish to use within the "Advanced Settings" section of the app's settings menu.

## What is this?
Conventional tools typically lock you into specific models and UIs.
Threebody is different. It allows you to freely combine models—such as Ollama, ChatGPT, Claude, Gemini, and DeepSeek—to reason about topics from three distinct perspectives and derive an answer.
## Quick Start
Clone the repository from GitHub and install the dependencies as follows:
```bash
git clone https://github.com/tkt0605/threebody
cd threebody
npm install
npm run dev:all
```