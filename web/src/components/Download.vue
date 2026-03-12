<template>
  <section id="download" class="w-full py-28 bg-white flex justify-center px-6 md:px-12">
    <div class="max-w-7xl w-full">
      <div class="text-center mb-20 space-y-4">
        <h2 class="text-4xl md:text-5xl font-black text-gray-900 tracking-tight">
          多端覆盖 · 随时召唤
        </h2>
        <p class="text-xl text-gray-500 max-w-2xl mx-auto font-medium">
          无论你在哪个终端，你的 <span class="text-primary">Soul Pal</span> 都能通过云端同步随时现身。
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <!-- Windows -->
        <div class="group relative bg-gray-50 rounded-[32px] p-10 flex flex-col items-center hover:bg-primary transition-all duration-500 overflow-hidden">
          <div class="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-700"></div>
          <div class="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
            <svg class="w-10 h-10 text-gray-900" fill="currentColor" viewBox="0 0 24 24"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>
          </div>
          <h3 class="text-2xl font-black text-gray-900 group-hover:text-white mb-2 transition-colors">Windows</h3>
          <p class="text-gray-400 group-hover:text-white/80 mb-8 font-medium transition-colors">v1.0.0 Stable</p>
          <button class="w-full py-4 bg-gray-900 text-white rounded-2xl font-black group-hover:bg-white group-hover:text-primary shadow-lg transition-all">
            立即下载
          </button>
        </div>

        <!-- macOS -->
        <div class="group relative bg-gray-50 rounded-[32px] p-10 flex flex-col items-center hover:bg-primary transition-all duration-500 overflow-hidden">
          <div class="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-700"></div>
          <div class="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
            <svg class="w-10 h-10 text-gray-900" fill="currentColor" viewBox="0 0 24 24"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.078-2.04 0-3.905 1.169-4.966 3.002-2.132 3.705-.544 9.176 1.532 12.174 1.016 1.465 2.215 3.11 3.805 3.11 1.532 0 2.112-.932 3.964-.932 1.848 0 2.378.932 3.96.932 1.644 0 2.684-1.488 3.692-2.956 1.16-1.69 1.636-3.324 1.66-3.412-.036-.012-3.184-1.22-3.216-4.82-.028-3 2.468-4.436 2.584-4.504-1.412-2.068-3.58-2.308-4.352-2.364-1.748-.14-3.412 1.06-4.304 1.06zm.644-2.008c.792-.956 1.324-2.284 1.18-3.612-1.144.048-2.528.764-3.348 1.72-.736.848-1.38 2.188-1.208 3.488 1.272.1 2.584-.64 3.376-1.596z"/></svg>
          </div>
          <h3 class="text-2xl font-black text-gray-900 group-hover:text-white mb-2 transition-colors">macOS</h3>
          <p class="text-gray-400 group-hover:text-white/80 mb-8 font-medium transition-colors">v1.0.0 Stable</p>
          <button class="w-full py-4 bg-gray-900 text-white rounded-2xl font-black group-hover:bg-white group-hover:text-primary shadow-lg transition-all">
            立即下载
          </button>
        </div>

        <!-- Android -->
        <div class="bg-gray-100/50 rounded-[32px] p-10 flex flex-col items-center border-2 border-dashed border-gray-200">
          <div class="w-20 h-20 bg-gray-200/50 rounded-2xl flex items-center justify-center mb-8 grayscale">
            <svg class="w-12 h-12 text-gray-400" fill="currentColor" viewBox="0 0 24 24"><path d="M17.523 11.341l1.838-3.183a.475.475 0 0 0-.174-.65.48.48 0 0 0-.655.173l-1.874 3.245A8.653 8.653 0 0 0 12 10c-1.664 0-3.228.412-4.658 1.044l-1.874-3.245a.48.48 0 0 0-.655-.173.475.475 0 0 0-.174.65l1.838 3.183A7.121 7.121 0 0 0 2.4 18.2h19.2a7.121 7.121 0 0 0-4.077-6.859zM8.847 15.83a1.184 1.184 0 1 1 0-2.368 1.184 1.184 0 0 1 0 2.368zm6.306 0a1.184 1.184 0 1 1 0-2.368 1.184 1.184 0 0 1 0 2.368z"/></svg>
          </div>
          <h3 class="text-2xl font-black text-gray-400 mb-2">Android</h3>
          <p class="text-gray-400 mb-8 font-medium">Coming Soon</p>
          <div class="w-full py-4 bg-gray-200 text-gray-400 rounded-2xl font-black text-center text-sm">
            敬请期待
          </div>
        </div>

        <!-- iOS -->
        <div class="bg-gray-100/50 rounded-[32px] p-10 flex flex-col items-center border-2 border-dashed border-gray-200">
          <div class="w-20 h-20 bg-gray-200/50 rounded-2xl flex items-center justify-center mb-8 grayscale text-gray-400">
            <svg class="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.078-2.04 0-3.905 1.169-4.966 3.002-2.132 3.705-.544 9.176 1.532 12.174 1.016 1.465 2.215 3.11 3.805 3.11 1.532 0 2.112-.932 3.964-.932 1.848 0 2.378.932 3.96.932 1.644 0 2.684-1.488 3.692-2.956 1.16-1.69 1.636-3.324 1.66-3.412-.036-.012-3.184-1.22-3.216-4.82-.028-3 2.468-4.436 2.584-4.504-1.412-2.068-3.58-2.308-4.352-2.364-1.748-.14-3.412 1.06-4.304 1.06zm.644-2.008c.792-.956 1.324-2.284 1.18-3.612-1.144.048-2.528.764-3.348 1.72-.736.848-1.38 2.188-1.208 3.488 1.272.1 2.584-.64 3.376-1.596z"/></svg>
          </div>
          <h3 class="text-2xl font-black text-gray-400 mb-2">iOS</h3>
          <p class="text-gray-400 mb-8 font-medium">Coming Soon</p>
          <div class="w-full py-4 bg-gray-200 text-gray-400 rounded-2xl font-black text-center text-sm">
            敬请期待
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
</script>
