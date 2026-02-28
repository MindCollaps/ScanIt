<template>
  <div v-if="showGallery && pages.length" class="preview-gallery">
    <div
      v-for="(page, idx) in pages"
      :key="page.url"
      class="preview-card"
      @click="openLightbox(idx)"
    >
      <div class="preview-img-wrapper">
        <img :src="page.url" :alt="`Page ${idx + 1}`" loading="lazy" />
      </div>
      <span class="preview-label">{{ idx + 1 }}</span>
    </div>
  </div>

  <!-- Lightbox -->
  <Teleport to="body">
    <div v-if="lightboxIdx !== null" class="lightbox-overlay" @click.self="closeLightbox">
      <div class="lightbox-content">
        <button class="lightbox-close" @click="closeLightbox">&times;</button>
        <button v-if="lightboxIdx > 0" class="lightbox-nav lightbox-prev" @click="lightboxIdx!--">
          &lsaquo;
        </button>
        <img
          :src="pages[lightboxIdx!]?.url"
          :alt="`Page ${lightboxIdx! + 1}`"
          class="lightbox-img"
        />
        <button
          v-if="lightboxIdx! < pages.length - 1"
          class="lightbox-nav lightbox-next"
          @click="lightboxIdx!++"
        >
          &rsaquo;
        </button>
        <span class="lightbox-counter">{{ lightboxIdx! + 1 }} / {{ pages.length }}</span>
        <div class="lightbox-actions">
          <button
            v-if="rotatable"
            class="lightbox-rotate"
            title="Rotate 90°"
            @click="emit('rotate', lightboxIdx!)"
          >
            &#8635; Rotate
          </button>
          <button
            v-if="deletable"
            class="lightbox-delete"
            title="Delete this page"
            @click="emit('delete', lightboxIdx!)"
          >
            &#128465; Delete
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

export interface PreviewPage {
  url: string;
  filename?: string;
}

const props = withDefaults(
  defineProps<{
    pages: PreviewPage[];
    showGallery?: boolean;
    deletable?: boolean;
    rotatable?: boolean;
  }>(),
  { showGallery: true, deletable: false, rotatable: false },
);

const emit = defineEmits<{
  'delete': [index: number];
  'rotate': [index: number];
}>();

const lightboxIdx = ref<number | null>(null);

const openLightbox = (idx: number): void => {
  lightboxIdx.value = idx;
};
const closeLightbox = (): void => {
  lightboxIdx.value = null;
};

defineExpose({ openLightbox });

const onKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') closeLightbox();
  if (lightboxIdx.value !== null) {
    if (e.key === 'ArrowLeft' && lightboxIdx.value > 0) lightboxIdx.value--;
    if (e.key === 'ArrowRight' && lightboxIdx.value < props.pages.length - 1) lightboxIdx.value++;
  }
};

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<style scoped>
.preview-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.preview-card {
  position: relative;
  width: 120px;
  overflow: hidden;
  border: 2px solid var(--border-default);
  border-radius: 0.4rem;
  background: var(--bg-elevated);
  cursor: pointer;
  transition:
    border-color 0.15s,
    transform 0.15s;
}

.preview-card:hover {
  border-color: var(--btn-primary-bg);
  transform: scale(1.04);
}

.preview-img-wrapper {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  aspect-ratio: 210 / 297;
  overflow: hidden;
  background: var(--bg-surface);
}

.preview-img-wrapper img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.preview-label {
  display: block;
  padding: 0.2rem 0;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 0.7rem;
  font-weight: 600;
  text-align: center;
}

/* ── Lightbox ───────────────────────────────────────────────────── */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-lightbox);
  backdrop-filter: blur(4px);
}

.lightbox-content {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 92vw;
  max-height: 92vh;
}

.lightbox-img {
  max-width: 88vw;
  max-height: 88vh;
  border-radius: 0.5rem;
  box-shadow: 0 8px 32px var(--shadow-heavy);
  object-fit: contain;
}

.lightbox-close {
  position: absolute;
  top: -2rem;
  right: -1rem;
  z-index: 1;
  border: none;
  background: none;
  color: var(--text-heading);
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
}

.lightbox-close:hover {
  color: var(--color-error);
}

.lightbox-nav {
  position: absolute;
  top: 50%;
  z-index: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: 0.4rem;
  background: var(--overlay-nav);
  color: var(--text-heading);
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
  transform: translateY(-50%);
}

.lightbox-nav:hover {
  border-color: var(--btn-primary-bg);
  background: var(--overlay-nav-hover);
}

.lightbox-prev {
  left: -3.5rem;
}

.lightbox-next {
  right: -3.5rem;
}

.lightbox-counter {
  position: absolute;
  bottom: -1.8rem;
  left: 50%;
  color: var(--text-muted);
  font-size: 0.8rem;
  white-space: nowrap;
  transform: translateX(-50%);
}

.lightbox-actions {
  position: absolute;
  right: -1rem;
  bottom: -1.8rem;
  display: flex;
  gap: 0.5rem;
}

.lightbox-rotate {
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
  cursor: pointer;
}
.lightbox-rotate:hover {
  border-color: var(--btn-primary-bg);
  color: var(--text-heading);
}

.lightbox-delete {
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--btn-danger-border);
  border-radius: 0.3rem;
  background: transparent;
  color: var(--color-error);
  font-size: 0.75rem;
  white-space: nowrap;
  cursor: pointer;
}
.lightbox-delete:hover {
  background: var(--btn-danger-bg-hover);
}
</style>
