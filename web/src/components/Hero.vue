<template>
  <section class="w-full min-h-[calc(100vh-76px)] flex items-center justify-center bg-white px-6 md:px-12 py-16 overflow-hidden">
    <div class="max-w-7xl w-full flex flex-col md:flex-row items-center justify-between relative">
      <!-- Decorative element -->
      <div class="absolute -top-24 -left-24 w-64 h-64 bg-primary/20 rounded-full blur-3xl"></div>
      
      <div class="flex-1 flex flex-col items-start justify-center space-y-8 md:pr-12 z-10">
        <div class="inline-flex items-center space-x-2 px-3 py-1 bg-primary/10 rounded-full text-primary font-bold text-sm tracking-wide uppercase">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          <span>Next-Gen AI Companion</span>
        </div>
        <h1 class="text-6xl md:text-7xl font-black text-gray-900 leading-[1.1] tracking-tight">
          赋予桌面 <br />
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">智能灵魂</span>
        </h1>
        <p class="text-xl md:text-2xl text-gray-500 leading-relaxed max-w-xl font-medium">
          <span class="text-gray-900 font-bold">Soul Pal</span> 
          不仅是宠物，更是你的智能伴侣。基于深层记忆与情感引擎，在桌面为你开启无限可能。
        </p>
        <div class="flex flex-col sm:flex-row gap-5 w-full sm:w-auto pt-4">
          <a href="#download" class="px-10 py-4.5 bg-primary text-gray-900 rounded-2xl font-black text-lg shadow-xl shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-1 transition-all text-center">
            立即开启灵魂对话
          </a>
          <a href="#features" class="px-10 py-4.5 bg-gray-50 text-gray-700 border border-gray-100 rounded-2xl font-bold text-lg hover:bg-white hover:shadow-lg transition-all text-center">
            探索核心特性
          </a>
        </div>
      </div>
      
      <div class="flex-1 w-full max-w-[550px] aspect-square mt-16 md:mt-0 relative group">
        <div class="absolute inset-0 bg-gradient-to-tr from-primary/20 to-secondary/20 rounded-[40px] rotate-6 group-hover:rotate-3 transition-transform duration-500"></div>
        <div class="absolute inset-0 bg-white shadow-2xl rounded-[40px] border border-gray-50 flex items-center justify-center p-8">
          <LottiePlayer path="/lottie/cat/玩球.json" />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import LottiePlayer from './LottiePlayer.vue'
</script>
