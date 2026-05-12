import { createRouter, createWebHistory } from 'vue-router'
import ChatView      from '../views/ChatView.vue'
import LoginView     from '../views/LoginView.vue'
import SignupView    from '../views/SignupView.vue'
import AuthCallback  from '../views/AuthCallback.vue'
import AozoraView    from '../views/AozoraView.vue'
import { supabase }  from '../lib/supabase'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',             component: ChatView,     meta: { requiresAuth: true } },
    { path: '/recreate_film',       component: AozoraView,   meta: { requiresAuth: true } },
    { path: '/login',        component: LoginView    },
    { path: '/signup',       component: SignupView   },
    { path: '/auth/callback', component: AuthCallback },
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
