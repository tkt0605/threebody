<script setup lang="ts">
import LegalPage from '../components/LegalPage.vue'
</script>

<template>
  <LegalPage title="ThreeBodyの使い方">
    <section>
      <p>
        ThreeBody は、AI の答えをもう一度別の AI に確かめさせる音声チャットです。
        1つの問いに1つの答えが返り、その答えを最大2つの別モデルが検算します。
      </p>
    </section>

    <section>
      <h2>ThreeBody でできること</h2>
      <ul>
        <li>球体をタップして、声で問いかける</li>
        <li>答えのうち最も崩れやすい点を指摘してもらう</li>
        <li>答えのとおり進めたときに抜けている前提を指摘してもらう</li>
        <li>おもしろかった問いを URL で渡し、相手の LLM でも走らせてもらう</li>
      </ul>
    </section>
    <section>
      <h2>共有</h2>
      <p>
        答えの下の共有ボタンを押すと、その問いの URL ができます。
        URL を開いた人は、同じ問いを自分の設定した LLM で走らせて、
        答えがどう変わるかを見られます。
      </p>
    </section>
    <section>
      <h2>始め方</h2>
      <p>
        Google アカウントでログインすると、1日3回まで無料で試せます。
        続けて使うときは、設定画面に自分の API キーを入力してください。
      </p>
    </section>

    <section>
      <h2>補足</h2>
      <ul>
        <li>検算は、答えが短いときや挨拶には付きません。</li>
        <li>検算の内容は主体の答えを書き換えません。別のカードとして並びます。</li>
        <li>名前は SF 小説『三体』から取っています。LLM を「体」と呼び、1体が答え、2体が検算します。</li>
      </ul>
    </section>
  </LegalPage>
</template>