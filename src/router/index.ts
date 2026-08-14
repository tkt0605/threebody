import { createRouter, createWebHistory } from 'vue-router'
import ChatView      from '../views/ChatView.vue'
import LoginView     from '../views/LoginView.vue'
import AuthCallback  from '../views/AuthCallback.vue'
import TermsView     from '../views/TermsView.vue'
import PrivacyView   from '../views/PrivacyView.vue'
import { supabase }  from '../lib/supabase'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',             component: ChatView,     meta: { requiresAuth: true } },
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
  ],
})

router.beforeEach(async (to) => {
  // /auth/callback はガードをスキップ（コード交換処理中のため）
  if (to.path === '/auth/callback') return

  const { data: { session } } = await supabase.auth.getSession()
  const authed = !!session

  if (to.meta.requiresAuth && !authed) return '/login'
  if ((to.path === '/login' || to.path === '/signup') && authed) return '/'
})

export default router
