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

> [!NOTE]
> Ollama is not selectable on the hosted version, because the server cannot reach an Ollama
> instance running on your own machine. To use Ollama, run the app locally via "Quick Start" below.

## Supported providers
| Provider | API key | Notes |
|---|---|---|
| Anthropic (Claude) | Required | |
| OpenAI (ChatGPT) | Required | |
| DeepSeek | Required | Treated as an OpenAI-compatible endpoint |
| Ollama | Not required | Local execution only |

## How to get an LLM API key
1. Visit the API consoles for OpenAI, Anthropic, or DeepSeek.
2. Create an account and log in.
3. Click **Create API key**.
4. Paste the obtained API key and select the LLM model you wish to use within the "Advanced Settings" section of the app's settings menu.

## Free trial quota (invite only)
For users without their own API key, there is a quota of **5 conversations per day** covered by the
operator's key. It is currently limited to accounts the operator has individually enabled — simply
signing in with Google does not activate it. When enabled, the thinking level is fixed at 2 to cap
the token cost the operator absorbs.

## What is this?
Conventional tools typically lock you into specific models and UIs.
Threebody is different. It allows you to freely combine models—such as Ollama, ChatGPT, Claude, and DeepSeek—to reason about topics from three distinct perspectives and derive an answer.
## Quick Start
Clone the repository from GitHub and install the dependencies as follows:
Create a new `.env` file and add the API keys you've obtained to it.
```bash
git clone https://github.com/tkt0605/threebody
cd threebody
npm install
npm run dev:all
```