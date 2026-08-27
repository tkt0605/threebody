import { createRouter, createWebHistory } from 'vue-router'
import ChatView      from '../views/ChatView.vue'
import LoginView     from '../views/LoginView.vue'
import AuthCallback  from '../views/AuthCallback.vue'
import TermsView     from '../views/TermsView.vue'
import PrivacyView   from '../views/PrivacyView.vue'
import DetailsView   from '../views/DetailsView.vue'
import SharedTurnView from '../views/SharedTurnView.vue'
import { supabase }  from '../lib/supabase'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // / への直接アクセス（ブックマーク・ログイン直後など）は常に新規会話へ。
    // 以前はChatViewを直接割り当てて最近の会話へ解決していたが、
    // アクセスするたびに古い会話へ飛ばされるのが分かりにくいためredirectに変更した
    { path: '/',              redirect: '/new' },
    // 「新規会話」の行き先。/ と違い、ここにいる間は最近の会話への解決（ensureConversation）を
    // 一切行わない。/ のままだとリロード時に「直近の会話」へ解決されてしまい、
    // 新規会話のつもりが古い会話に戻ってしまう
    { path: '/new',           component: ChatView,     meta: { requiresAuth: true } },
    // 会話ごとにURLを分けて識別できるようにする（/ はensure後にここへ置換される）
    { path: '/c/:id',        component: ChatView,     meta: { requiresAuth: true } },
    { path: '/login',        component: LoginView    },
    // Google 認証ではサインアップ/ログインの区別がないため /login に集約
    { path: '/signup',       redirect: '/login'      },
    { path: '/auth/callback', component: AuthCallback },
    // 規約とプライバシーポリシーは requiresAuth を付けない。
    // ログイン前に読めないと「同意して続行」の同意が成立せず、Google OAuth の
    // 審査もこのURLへ未ログインで到達できることを前提にしている
    { path: '/terms',        component: TermsView    },
    { path: '/privacy',      component: PrivacyView  },
    // 使い方の説明。/terms と同様 requiresAuth を付けない。ログイン前（LoginView）
    // からも読めないと「初めての人向け」の役目を果たせない
    { path: '/details',      component: DetailsView  },
    // 共有された1ターン（ROADMAP ③）。requiresAuth を付けない。
    // 未ログインで開けないと、そもそもこの機能の存在理由（閲覧者にLLMを呼ばせず、
    // 何人見ても無料枠が減らない拡散経路）が無くなる
    { path: '/s/:token',     component: SharedTurnView },
  ],
})

router.beforeEach(async (to) => {
  // /auth/callback はガードをスキップ（コード交換処理中のため）
  if (to.path === '/auth/callback') return

  const { data: { session } } = await supabase.auth.getSession()
  const authed = !!session

  // 行き先を落とさずログインへ回す。共有ページの導線（問いを持ってアプリへ入る）は
  // ここで消えると意味が無くなる。実際の復帰は /auth/callback（lib/postLogin.ts）
  if (to.meta.requiresAuth && !authed) return { path: '/login', query: { next: to.fullPath } }
  if ((to.path === '/login' || to.path === '/signup') && authed) return '/new'
})

export default router
