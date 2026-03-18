<template>
  <div class="min-h-screen flex flex-col font-sans">
    <!-- Navbar -->
    <header class="w-full bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-6 md:px-12 py-4 flex justify-between items-center">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-black shadow-sm transform -rotate-3">
            AI
          </div>
          <span class="text-2xl font-black text-gray-900 tracking-tight">Soul Pal</span>
        </div>
        <nav class="hidden md:flex space-x-10">
          <a href="#features" class="text-gray-600 hover:text-primary transition-colors font-semibold">产品特性</a>
          <a href="#download" class="text-gray-600 hover:text-primary transition-colors font-semibold">下载多端</a>
          <a href="#contact" class="text-gray-600 hover:text-primary transition-colors font-semibold">联系与留言</a>
        </nav>
        <a href="#download" class="px-6 py-2.5 bg-primary text-gray-900 font-bold rounded-full hover:shadow-lg hover:scale-105 transition-all text-sm">
          立即获取
        </a>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-grow">
      <Hero />
      <Features />
      <Download />
      <ContactAndRating />
    </main>

    <!-- Footer -->
    <footer class="w-full bg-gray-950 text-white py-16 px-6">
      <div class="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center">
        <div class="mb-10 md:mb-0">
          <div class="flex items-center space-x-3 mb-4">
            <div class="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-gray-950 font-black text-sm">
              AI
            </div>
            <span class="text-xl font-black">Soul Pal</span>
          </div>
          <p class="text-gray-400 text-sm max-w-xs">你的专属智能 Soul Pal 桌面陪伴，赋予桌面灵魂。懂你的情绪，记你的习惯。</p>
        </div>
        <div class="flex flex-wrap gap-8 text-sm text-gray-400">
          <a href="#" class="hover:text-white transition-colors">隐私政策</a>
          <a href="#" class="hover:text-white transition-colors">服务条款</a>
          <a href="#" class="hover:text-white transition-colors">GitHub 仓库</a>
        </div>
      </div>
      <div class="max-w-7xl mx-auto border-t border-gray-800 mt-12 pt-8 text-center md:text-left text-gray-500 text-xs">
        &copy; 2026 Soul Pal. All rights reserved. Built with Soul.
      </div>
    </footer>
  </div>
</template>

<script setup>
import LottiePlayer from './components/LottiePlayer.vue'
import Hero from './components/Hero.vue'
import Features from './components/Features.vue'
import Download from './components/Download.vue'
import ContactAndRating from './components/ContactAndRating.vue'
</script>
