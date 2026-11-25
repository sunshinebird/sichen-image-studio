import { createApp } from 'vue'
import studioUI from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import './styles/ui.css'
import './styles/base.css'

createApp(App).use(studioUI).mount('#app')
