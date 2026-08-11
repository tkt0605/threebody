import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.github/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  // 【essential を選ぶ理由】上位の flat/recommended には整形ルール（html-indent,
  // max-attributes-per-line, singleline-html-element-content-newline 等）が含まれ、
  // 手で整形しているこのリポジトリでは警告が491件出た。整形の好みを機械と争っても
  // 欠陥は1件も減らないので、誤り検出に効く essential 層だけを採る。
  // 整形を統一したくなったら Prettier を別途入れるほうが筋が良い
  pluginVue.configs['flat/essential'],

  // 型情報を使う検査のために、tsconfig をプロジェクト全体から自動解決させる
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        // .vue は TypeScript から見て非標準拡張子なので、明示しないと
        // 「プロジェクトに含まれていない」として解析自体が失敗する
        extraFileExtensions: ['.vue'],
      },
    },
  },

  // .vue の <script setup lang="ts"> を typescript-eslint のパーサで読む。
  // vue-eslint-parser がテンプレートを、parserOptions.parser がスクリプトを担当する
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // 子コンポーネントへの ref は Vue 公式が薦める
      // ref<InstanceType<typeof Child> | null>(null) の形を取るが、.vue の型は
      // any に解決されるため「any が union を飲み込む」と誤検出される。
      // イディオムそのものを否定することになるので .vue でだけ切る
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },

  {
    rules: {
      // ── 意図して切っているもの ────────────────────────────────────────────
      // no-undef は TypeScript の担当領域と重複し、しかも型を理解しないため
      // window / document / requestAnimationFrame 等をすべて未定義と誤検出する
      // （typescript-eslint 自身も TS プロジェクトでの無効化を推奨している）。
      // 未定義の識別子は tsc / vue-tsc が確実に捕まえる
      'no-undef': 'off',

      // 全角スペース（U+3000）はコード中では見えない事故のもとだが、
      // 日本語のコメント・文字列では正当な文字。コードの側だけを検査する
      'no-irregular-whitespace': ['error', {
        skipComments:  true,
        skipStrings:   true,
        skipTemplates: true,
      }],

      // 単語1つのコンポーネント名（VoiceSphere.vue に対する Sphere など）は
      // このリポジトリの規約と合わないため
      'vue/multi-word-component-names': 'off',

      // ── 段階的に error へ上げる（現時点では警告に留める）──────────────────
      // await 忘れの検出。このリポジトリで実際に事故になった種類なので、
      // 違反を潰しきったら error に上げること
      '@typescript-eslint/no-floating-promises': 'warn',
      // any は既存コードに残っている。新規で増やさないことが目的
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // ── 実害のある取り違えだけを error にする ──────────────────────────────
      // 未使用の変数。_ 始まりは「意図的に使わない」の印として許す
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern:         '^_',
        varsIgnorePattern:         '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },

  // ルート直下の設定ファイル群は tsconfig の include に入っていないため、
  // 型情報つきの検査から外す（型情報を要求する時点で解析が失敗する）。
  //
  // 【順序が重要】上の rules ブロックが全ファイルに no-floating-promises 等を
  // 有効化するので、この打ち消しは必ずその後ろに置くこと。前に置くと
  // 「型情報が要るルールが、型情報を切ったファイルで有効」になり lint 自体が起動しない
  {
    files: ['*.config.ts', '*.config.js', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // テストは検査を緩める。モックの都合で any や非同期の扱いが実装コードと異なるため、
  // ここを厳しくすると「テストを書きにくくする lint」になって本末転倒になる
  {
    files: ['**/tests/**/*.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any':          'off',
      '@typescript-eslint/no-unsafe-assignment':     'off',
      '@typescript-eslint/no-unsafe-member-access':  'off',
      '@typescript-eslint/no-unsafe-argument':       'off',
      '@typescript-eslint/no-unsafe-call':           'off',
      '@typescript-eslint/no-unsafe-return':         'off',
      '@typescript-eslint/unbound-method':           'off',
      // モックは「本物と同じ非同期シグネチャ」を満たす必要があり、
      // 中で await しないことがある。実装コード側では有効なまま残す
      '@typescript-eslint/require-await':            'off',
    },
  },
)
