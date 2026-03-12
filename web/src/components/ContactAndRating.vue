<template>
  <section id="contact" class="w-full py-28 bg-gray-50 flex justify-center px-6 md:px-12">
    <div class="max-w-7xl w-full flex flex-col lg:flex-row gap-12">
      <!-- Contact Form -->
      <div class="flex-[1.5] bg-white p-12 rounded-[40px] shadow-xl shadow-gray-200/50 border border-gray-100">
        <h3 class="text-4xl font-black text-gray-900 mb-2">留下你的足迹</h3>
        <p class="text-gray-500 mb-10 font-medium text-lg">期待听到关于 <span class="text-primary">Soul Pal</span> 的任何反馈或奇思妙想。</p>
        <form @submit.prevent="submitForm" class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-black text-gray-700 mb-2 uppercase tracking-wider">您的称呼</label>
              <input 
                v-model="formData.name"
                type="text" 
                class="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-4 focus:ring-primary/20 focus:bg-white focus:border-primary outline-none transition-all font-medium" 
                placeholder="怎么称呼您？" 
              />
            </div>
            <div>
              <label class="block text-sm font-black text-gray-700 mb-2 uppercase tracking-wider">联系邮箱 (选填)</label>
              <input 
                v-model="formData.email"
                type="email" 
                class="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-4 focus:ring-primary/20 focus:bg-white focus:border-primary outline-none transition-all font-medium" 
                placeholder="example@mail.com" 
              />
            </div>
          </div>
          <div>
            <label class="block text-sm font-black text-gray-700 mb-2 uppercase tracking-wider">留言内容</label>
            <textarea 
              v-model="formData.message"
              rows="5" 
              class="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-4 focus:ring-primary/20 focus:bg-white focus:border-primary outline-none transition-all font-medium resize-none" 
              placeholder="在这里输入你想说的话..."
            ></textarea>
          </div>
          <div v-if="errorMsg" class="text-primary text-sm font-bold animate-bounce">
            ⚠️ {{ errorMsg }}
          </div>
          <button type="submit" class="w-full py-5 bg-primary text-gray-900 font-black text-xl rounded-2xl hover:bg-opacity-90 shadow-xl transition-all active:scale-[0.98]">
            提交我的灵魂留言
          </button>
        </form>
      </div>

      <!-- Rating -->
      <div class="flex-1 bg-gradient-to-br from-primary to-primary/80 p-12 rounded-[40px] shadow-xl shadow-primary/20 flex flex-col items-center justify-center text-center">
        <h3 class="text-3xl font-black text-gray-950 mb-4">喜欢这个项目吗？</h3>
        <p class="text-gray-900/70 mb-10 font-bold text-lg leading-relaxed">你的评价是 Soul Pal 进化的燃料</p>
        
        <div class="flex space-x-3 mb-8 bg-white/20 p-6 rounded-3xl backdrop-blur-sm">
          <button v-for="star in 5" :key="star" @click="rating = star" @mouseenter="hoverRating = star" @mouseleave="hoverRating = 0" class="text-5xl focus:outline-none transition-all hover:scale-125">
            <span :class="star <= (hoverRating || rating) ? 'text-white' : 'text-white/30'">★</span>
          </button>
        </div>
        <div class="px-8 py-3 bg-white rounded-full shadow-lg">
          <p class="text-xl font-black text-primary min-w-[120px]">
            {{ ratingText }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'

const rating = ref(0)
const hoverRating = ref(0)
const errorMsg = ref('')

const formData = reactive({
  name: '',
  email: '',
  message: ''
})

const submitForm = () => {
  errorMsg.value = ''
  
  if (!formData.name.trim()) {
    errorMsg.value = '请先告诉我们怎么称呼您'
    return
  }
  
  if (!formData.message.trim()) {
    errorMsg.value = '留言内容不能为空哦'
    return
  }
  
  alert(`感谢 ${formData.name}！留言已成功传送至灵魂档案库。`)
  formData.name = ''
  formData.email = ''
  formData.message = ''
}

const ratingText = computed(() => {
  const current = hoverRating.value || rating.value
  switch(current) {
    case 1: return '需要改进 😔'
    case 2: return '勉强及格 😕'
    case 3: return '还不错 😐'
    case 4: return '很好用 😊'
    case 5: return '太棒了！🤩'
    default: return '期待评分 ✨'
  }
})
</script>
