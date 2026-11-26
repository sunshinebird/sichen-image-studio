<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { ArrowUpRight, Github, Images, MessageSquarePlus, X } from 'lucide-vue-next'

defineProps<{ repository: string }>()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const contributions = [
  { path: '/issues/new?template=idea.yml', icon: MessageSquarePlus, title: '提功能建议', detail: '说说你想增加什么功能，或创作时哪一步不顺手。' },
  { path: '/issues/new?template=case.yml', icon: Images, title: '分享案例与提示词', detail: '附上原创图片和中文提示词，方便大家做同款。' },
  { path: '/blob/HEAD/CONTRIBUTING.md', icon: Github, title: '参与开发', detail: '看贡献指南，一起改进代码、模板和文档。' },
]

function open() {
  if (dialog.value && !dialog.value.open) dialog.value.showModal()
}
defineExpose({ open })
</script>

<template>
  <dialog id="studio-open-source-dialog" ref="dialog" class="studio-modal contribution-dialog"
    aria-labelledby="contribution-title" aria-describedby="contribution-note" @click.self="dialog?.close()">
    <section class="studio-modal-content">
      <div class="modal-head">
        <h2 id="contribution-title">开源共建</h2>
        <button type="button" class="base-button icon-button" aria-label="关闭开源共建" autofocus @click="dialog?.close()">
          <X :size="18" aria-hidden="true" />
        </button>
      </div>
      <ul class="contribution-list">
        <li v-for="item in contributions" :key="item.path">
          <a class="contribution-option" :href="repository + item.path" target="_blank" rel="noopener noreferrer">
            <span class="contribution-icon"><component :is="item.icon" :size="19" aria-hidden="true" /></span>
            <span class="contribution-copy"><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span>
            <ArrowUpRight class="contribution-arrow" :size="17" aria-hidden="true" />
          </a>
        </li>
      </ul>
      <div class="contribution-links">
        <a :href="repository" target="_blank" rel="noopener noreferrer">查看 GitHub 仓库</a>
        <a :href="repository + '/issues/new?template=bug.yml'" target="_blank" rel="noopener noreferrer">反馈使用问题</a>
      </div>
      <p id="contribution-note" class="contribution-note">链接在新标签页打开。提交时需要 GitHub 账号。</p>
    </section>
  </dialog>
</template>

<style scoped>
.contribution-dialog { width: min(100% - 24px, 500px); }
.contribution-list { display: grid; gap: 8px; padding: 0; margin: 16px 0 12px; list-style: none; }
.contribution-option {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px;
  min-height: 66px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel); color: var(--ink); text-decoration: none;
}
.contribution-option:hover { border-color: var(--control-active-border); background: var(--soft); }
.contribution-icon {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px;
  background: var(--soft); color: var(--action);
}
.contribution-copy { display: grid; gap: 2px; }
.contribution-copy small { color: var(--muted); font-size: .85rem; }
.contribution-arrow { color: var(--action); }
.contribution-links { display: flex; flex-wrap: wrap; gap: 0 16px; }
.contribution-links a {
  display: inline-flex; align-items: center; min-height: 44px; border-radius: 4px;
  color: var(--action); font-size: .875rem; text-underline-offset: 3px;
}
.contribution-dialog .contribution-note { margin: 0; font-size: .8rem; }
@media (max-width: 400px) {
  .contribution-dialog .studio-modal-content { padding: 16px; }
  .contribution-option { gap: 9px; padding-inline: 9px; }
  .contribution-icon { width: 32px; height: 32px; }
}
</style>
