<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, PanelsTopLeft } from 'lucide-vue-next'
import type { Case } from '../studio/catalog'
import { galleryCardSizes, gallerySources } from '../studio/imageView'

const { item, eager } = defineProps<{ item: Case; eager: boolean }>()
const emit = defineEmits<{ details: []; choose: [] }>()
const action = computed(() => item.pages ? '编辑模板' : item.start === 'upload' ? '用提示词改图' : '做同款')
</script>

<template>
  <article class="sa-case">
    <button type="button" class="sa-media sa-card-art sa-plain" :data-art="item.id"
      :aria-label="item.name + '，查看案例'" @click="emit('details')">
      <img :src="item.thumbnail ?? item.image" :srcset="gallerySources(item.image, item.width)" :sizes="galleryCardSizes"
        alt="" :width="item.width" :height="item.height" :loading="eager ? 'eager' : 'lazy'" decoding="async">
      <span v-if="item.id === 'coffee'" class="sa-card-letter sa-coffee-letter">午后<br>咖啡节</span>
      <span v-if="item.id === 'deck'" class="sa-card-letter sa-deck-letter">向新<br>而行</span>
      <span v-if="item.pages" class="sa-page-tag"><PanelsTopLeft :size="13" aria-hidden="true" /> 可编辑演示</span>
      <span v-else-if="item.presentation === 'slide-reference'" class="sa-page-tag">演示设计</span>
      <span v-else-if="item.start === 'edit'" class="sa-page-tag">含改图前后</span>
    </button>
    <div class="sa-case-meta">
      <button class="sa-plain case-name" type="button" :title="item.name" @click="emit('details')">{{ item.name }}</button>
      <button type="button" class="sa-remix" :aria-label="item.name + '，' + action" @click="emit('choose')">
        {{ action }} <ArrowRight :size="14" aria-hidden="true" />
      </button>
      <p>{{ item.industry }}</p>
    </div>
  </article>
</template>
