<template>
  <div ref="lottieContainer" class="w-full h-full flex justify-center items-center"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import lottie from 'lottie-web'

const props = defineProps({
  path: {
    type: String,
    required: true
  },
  loop: {
    type: Boolean,
    default: true
  },
  autoplay: {
    type: Boolean,
    default: true
  }
})

const lottieContainer = ref(null)
let animationItem = null

onMounted(() => {
  if (lottieContainer.value) {
    animationItem = lottie.loadAnimation({
      container: lottieContainer.value,
      renderer: 'svg',
      loop: props.loop,
      autoplay: props.autoplay,
      path: props.path
    })
  }
})

onUnmounted(() => {
  if (animationItem) {
    animationItem.destroy()
  }
})
</script>
