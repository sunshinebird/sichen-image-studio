<script setup lang="ts" generic="Value extends string">
import { Check, ChevronDown } from 'lucide-vue-next'
import {
  SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal,
  SelectRoot, SelectTrigger, SelectValue, SelectViewport,
} from 'reka-ui'

defineOptions({ inheritAttrs: false })
const model = defineModel<Value>({ required: true })
const { label, items } = defineProps<{
  label: string
  items: readonly { value: Value; label: string; detail?: string }[]
}>()

function select(value: unknown) {
  const item = items.find(option => option.value === value)
  if (item) model.value = item.value
}
</script>

<template>
  <SelectRoot :model-value="model" @update:model-value="select">
    <SelectTrigger v-bind="$attrs" class="studio-select" :aria-label="label">
      <span v-if="$slots.icon" class="studio-select-icon" aria-hidden="true"><slot name="icon" /></span>
      <SelectValue class="studio-select-value" />
      <ChevronDown class="studio-select-chevron" :size="14" aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="studio-select-menu" position="popper" align="end" :side-offset="8" :collision-padding="10">
        <SelectViewport class="studio-select-list">
          <SelectItem v-for="item in items" :key="item.value" :value="item.value" class="studio-select-item">
            <SelectItemText>{{ item.label }}</SelectItemText>
            <span v-if="item.detail" class="studio-select-detail">{{ item.detail }}</span>
            <SelectItemIndicator class="studio-select-indicator"><Check :size="15" aria-hidden="true" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
.studio-select {
  display: inline-flex;
  min-height: 42px;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  color: var(--ink);
  font-size: 13px;
  white-space: nowrap;
}
.studio-select:hover, .studio-select[data-state="open"] { border-color: var(--ring); }
.studio-select-icon { display: inline-flex; color: var(--muted); }
.studio-select-value { min-width: 0; text-overflow: ellipsis; overflow: hidden; }
.studio-select-chevron { margin-inline-start: auto; color: var(--muted); flex: none; }
.studio-select-menu {
  z-index: 40;
  width: max(168px, var(--reka-select-trigger-width));
  max-width: calc(100vw - 20px);
  max-height: var(--reka-select-content-available-height);
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--panel);
  color: var(--ink);
  box-shadow: var(--floating-shadow);
  overflow: hidden;
}
.studio-select-list { padding: 5px; max-height: var(--reka-select-content-available-height); overscroll-behavior: contain; }
.studio-select-item {
  position: relative;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 5px 31px 5px 10px;
  border-radius: 7px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.studio-select-item[data-highlighted] { background: var(--soft); color: var(--action); outline: none; }
.studio-select-item[data-state="checked"] { color: var(--action); font-weight: 650; }
.studio-select-detail { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.studio-select-indicator { position: absolute; inset-inline-end: 9px; display: flex; }
@media (pointer: coarse) {
  .studio-select, .studio-select-item { min-height: 44px; }
}
</style>
