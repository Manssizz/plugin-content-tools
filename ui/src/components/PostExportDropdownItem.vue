<script lang="ts" setup>
import type { ExportType, ImageExportMode } from '@/class/contentExporter';
import type { ListedPost } from '@halo-dev/api-client';
import { Toast, VButton, VDropdownItem, VModal, VSpace } from '@halo-dev/components';
import { ref, useTemplateRef } from 'vue';

interface ExportForm {
  type: ExportType;
  includeImages: boolean;
  imageExportMode: ImageExportMode;
}

const exportTypeOptions: { label: string; value: ExportType }[] = [
  { label: 'Markdown', value: 'markdown' },
  { label: 'HTML', value: 'html' },
  { label: 'PDF', value: 'pdf' },
];

const imageExportModeOptions: { label: string; value: ImageExportMode }[] = [
  { label: 'File', value: 'file' },
  { label: 'Inline', value: 'inline' },
];

const { post } = defineProps<{
  post: ListedPost;
}>();

const display = ref(false);

const modal = useTemplateRef<InstanceType<typeof VModal> | null>('modal');

const exporting = ref(false);

async function onSubmit(data: ExportForm) {
  const { ContentExporter } = await import('@/class/contentExporter');
  try {
    exporting.value = true;
    await ContentExporter.export(post.post, data.type, data.includeImages, data.imageExportMode);
    modal.value?.close();
    Toast.success('Export successful');
  } catch (error) {
    console.error(error);
    Toast.error('Export failed, please try again');
  } finally {
    exporting.value = false;
  }
}
</script>
<template>
  <VDropdownItem @click="display = true">Export</VDropdownItem>
  <VModal
    v-if="display"
    ref="modal"
    :centered="false"
    title="Export"
    mount-to-body
    @close="display = false"
  >
    <FormKit
      id="post-export-form"
      v-slot="{ value }"
      type="form"
      name="post-export-form"
      @submit="onSubmit"
    >
      <FormKit label="Export Format" type="select" name="type" :options="exportTypeOptions" />
      <FormKit v-if="value.type !== 'pdf'" label="Include Images" type="checkbox" name="includeImages" />
      <FormKit
        v-if="value.type !== 'pdf' && value.includeImages"
        type="select"
        label="Image Export Mode"
        name="imageExportMode"
        :options="imageExportModeOptions"
        :help="
          value.imageExportMode === 'file'
            ? 'When exporting as file, images will be exported as attachments and compressed together with the article'
            : 'When exporting as inline, images will be embedded in Base64 format into the exported file'
        "
      ></FormKit>
    </FormKit>
    <template #footer>
      <VSpace>
        <!-- @vue-ignore -->
        <VButton type="secondary" :loading="exporting" @click="$formkit.submit('post-export-form')">
          Export
        </VButton>
        <VButton @click="modal?.close()">Cancel</VButton>
      </VSpace>
    </template>
  </VModal>
</template>
