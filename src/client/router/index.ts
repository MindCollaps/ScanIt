import { createRouter, createWebHistory } from 'vue-router';
import ScanPage from '../pages/ScanPage.vue';
import HistoryPage from '../pages/HistoryPage.vue';
import ConfigPage from '../pages/ConfigPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/scan' },
    { path: '/scan', component: ScanPage },
    { path: '/history', component: HistoryPage },
    { path: '/config', component: ConfigPage },
  ],
});
