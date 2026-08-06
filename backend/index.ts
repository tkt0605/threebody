import './loadEnv'
import express from 'express'
import cors from 'cors'
import chatRouter from './routes/chat'
import capabilitiesRouter from './routes/capabilities'
import healthRouter from './routes/health'

const app = express()
// Render等のリバースプロキシ経由で動くため、req.ip は既定だとプロキシ自身のIPになり、
// 全ユーザーが同一IP扱いになってしまう（chatRouter内のchatRateLimitが全員を1つのバケットとして数える）。
// 1 はプロキシ1ホップぶんを信頼する意味で、X-Forwarded-For の一番右（＝直前のプロキシが
// 付けた値）を実クライアントIPとして採用する。Render/Heroku等の単一プロキシ構成の定番設定
app.set('trust proxy', 1)
app.use(cors({ origin: process.env.VITE_ORIGIN_BASE_URL }))
app.use(express.json())

app.use('/api', chatRouter)
app.use('/api', capabilitiesRouter)
app.use('/api', healthRouter)

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`ThreeBody API listening on :${PORT}`)
})

