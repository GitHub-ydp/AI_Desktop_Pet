<template>
  <section id="features" class="w-full py-28 bg-gray-50 flex justify-center px-6 md:px-12">
    <div class="max-w-7xl w-full">
      <div class="text-center mb-20 space-y-4">
        <h2 class="text-4xl md:text-5xl font-black text-gray-900 tracking-tight">
          为什么要选择 <span class="text-primary">Soul Pal</span>？
        </h2>
        <p class="text-xl text-gray-500 max-w-3xl mx-auto font-medium">
          不止是桌面挂件，更是你的智能工作生活助理，赋予每一次点击以生命。
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-10">
        <!-- Feature 1 -->
        <div class="bg-white rounded-[32px] p-10 shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 transition-all duration-300 border border-gray-100 flex flex-col items-center">
          <div class="w-28 h-28 mb-8 bg-primary/10 rounded-3xl flex items-center justify-center p-4">
            <LottiePlayer path="/lottie/cat/猫坐在枕头上.json" />
          </div>
          <h3 class="text-2xl font-black text-gray-900 mb-4">极简桌面交互</h3>
          <p class="text-gray-500 text-center leading-relaxed font-medium">
            透明窗口、始终置顶。4种性格（治愈/搞笑/傲娇/助理）动态切换。Ta 会呼吸、会思考，更会实时反馈 Ta 的小情绪。
          </p>
        </div>

        <!-- Feature 2 -->
        <div class="bg-white rounded-[32px] p-10 shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 transition-all duration-300 border border-gray-100 flex flex-col items-center">
          <div class="w-28 h-28 mb-8 bg-primary/10 rounded-3xl flex items-center justify-center p-4 text-primary">
            <LottiePlayer path="/lottie/cat/睡觉.json" />
          </div>
          <h3 class="text-2xl font-black text-gray-900 mb-4">仿人脑记忆系统</h3>
          <p class="text-gray-500 text-center leading-relaxed font-medium">
            内置 FSRS 记忆曲线算法。Ta 能精准捕捉你提及的细节与情感，拥有属于你们的独特回忆库，拒绝“阅后即焚”。
          </p>
        </div>

        <!-- Feature 3 -->
        <div class="bg-white rounded-[32px] p-10 shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 transition-all duration-300 border border-gray-100 flex flex-col items-center">
          <div class="w-28 h-28 mb-8 bg-primary/10 rounded-3xl flex items-center justify-center p-4">
            <LottiePlayer path="/lottie/cat/骑扫帚.json" />
          </div>
          <h3 class="text-2xl font-black text-gray-900 mb-4">Agent 进化引擎</h3>
          <p class="text-gray-500 text-center leading-relaxed font-medium">
            全能智能体。支持 DeepSeek/GPT 等顶级模型，内置 12+ 本地增强能力：文件管理、截图翻译、系统自动化等。
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import LottiePlayer from './LottiePlayer.vue'
</script>
