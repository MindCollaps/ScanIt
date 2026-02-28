import { createRouter, createWebHistory } from 'vue-router';
import ScanPage from '../pages/ScanPage.vue';
import HistoryPage from '../pages/HistoryPage.vue';
import ConfigPage from '../pages/ConfigPage.vue';
import DiagnosticsPage from '../pages/DiagnosticsPage.vue';
import JobDetailPage from '../pages/JobDetailPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/scan' },
    { path: '/scan', component: ScanPage },
    { path: '/history', component: HistoryPage },
    { path: '/jobs/:jobId', component: JobDetailPage },
    { path: '/config', component: ConfigPage },
    { path: '/diagnostics', component: DiagnosticsPage },
  ],
});
