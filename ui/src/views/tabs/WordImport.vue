<script lang="ts" setup>
import { randomUUID } from '@/utils/id';
import turndownService from '@/utils/turndown';
import {
  consoleApiClient,
  ucApiClient,
  type Attachment,
  type PostRequest,
} from '@halo-dev/api-client';
import {
  VAlert,
  VButton,
  VEntity,
  VEntityContainer,
  VEntityField,
  VSpace,
} from '@halo-dev/components';
import { useSessionStorage } from '@vueuse/core';
import mammoth from 'mammoth';
import PQueue from 'p-queue';
import { computed, reactive, ref } from 'vue';
import MingcuteCheckCircleFill from '~icons/mingcute/check-circle-fill';
import MingcuteCloseCircleLine from '~icons/mingcute/close-circle-line';
import MingcuteDocumentLine from '~icons/mingcute/document-line';
import MingcuteLoading3Fill from '~icons/mingcute/loading-3-fill';
import MingcuteTimeLine from '~icons/mingcute/time-line';

const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const convertToMarkdown = ref(false);
const publishAfterImport = ref(true);

interface ImportItem {
  id: string;
  file: File;
  filename: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
}

const importQueue = reactive<ImportItem[]>([]);
const queue = new PQueue({ concurrency: 3 });

const queueStats = computed(() => {
  const total = importQueue.length;
  const pending = importQueue.filter((item) => item.status === 'pending').length;
  const processing = importQueue.filter((item) => item.status === 'processing').length;
  const success = importQueue.filter((item) => item.status === 'success').length;
  const error = importQueue.filter((item) => item.status === 'error').length;

  return {
    total,
    pending,
    processing,
    success,
    error,
    queueSize: queue.size,
    queuePending: queue.pending,
  };
});

const isBusy = computed(() => {
  return queueStats.value.processing > 0;
});

function isWordFile(file: File): boolean {
  const wordTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
  ];
  return wordTypes.includes(file.type) || file.name.endsWith('.docx') || file.name.endsWith('.doc');
}

function onFilesSelected(event: Event) {
  const files = (event.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isWordFile(file)) {
      const isDuplicate = importQueue.some(
        (item) => item.file.name === file.name && item.file.size === file.size
      );

      if (!isDuplicate) {
        importQueue.push({
          id: randomUUID(),
          file,
          filename: file.name,
          status: 'pending',
        });
      }
    }
  }

  if (fileInput.value) fileInput.value.value = '';
}

function onFolderSelected(event: Event) {
  const files = (event.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  const existingFileNames = new Set(importQueue.map((item) => item.filename));

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.webkitRelativePath) continue;

    if (isWordFile(file)) {
      if (!existingFileNames.has(file.name)) {
        importQueue.push({
          id: randomUUID(),
          file,
          filename: file.name,
          status: 'pending',
        });
        existingFileNames.add(file.name);
      }
    }
  }

  if (folderInput.value) folderInput.value.value = '';
}

async function uploadImageBuffer(imageBuffer: ArrayBuffer, filename: string): Promise<Attachment> {
  try {
    const blob = new Blob([imageBuffer]);
    const file = new File([blob], filename, { type: 'image/png' });

    const { data } = await ucApiClient.storage.attachment.createAttachmentForPost({
      file: file,
      waitForPermalink: true,
    });

    return data;
  } catch (error) {
    console.error('Failed to upload image:', error);
    throw error;
  }
}

async function processWordDocument(file: File): Promise<{ html: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;

        const fileName = file.name.replace(/\.(docx?|DOC|DOCX)$/i, '');

        const options = {
          convertImage: mammoth.images.imgElement(async (image: any) => {
            try {
              const imageBuffer = await image.read();
              const filename = `${fileName}_${randomUUID()}.png`;
              const attachment = await uploadImageBuffer(imageBuffer, filename);
              return {
                src: attachment.status?.permalink || '',
              };
            } catch (error) {
              console.warn('Failed to upload image:', error);
              return { src: '' };
            }
          }),
        };

        const result = await mammoth.convertToHtml({ arrayBuffer }, options);

        resolve({
          html: result.value,
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
  });
}

async function processItem(item: ImportItem): Promise<void> {
  item.status = 'processing';

  try {
    const { html } = await processWordDocument(item.file);
    await createPost(item, html);
    item.status = 'success';
  } catch (error) {
    console.error('Failed to process item:', error);
    item.status = 'error';
    item.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

async function handleStart() {
  if (isBusy.value) return;

  const pendingItems = importQueue.filter(
    (item) => item.status === 'pending' || item.status === 'error'
  );

  if (pendingItems.length === 0) return;

  const promises = pendingItems.map((item) => queue.add(() => processItem(item)));
  await Promise.allSettled(promises);
}

function handleRetryAll() {
  if (isBusy.value) return;

  importQueue
    .filter((item) => item.status === 'error')
    .forEach((item) => {
      item.status = 'pending';
      item.error = undefined;
    });

  handleStart();
}

function retryItem(item: ImportItem) {
  if (isBusy.value) return;

  item.status = 'pending';
  item.error = undefined;

  queue.add(() => processItem(item));
}

async function createPost(item: ImportItem, html: string) {
  const fileName = item.file.name.replace(/\.(docx?|DOC|DOCX)$/i, '');

  const postToCreate: PostRequest = {
    post: {
      spec: {
        title: fileName,
        slug: fileName.toLowerCase().replace(/\s+/g, '-'),
        template: '',
        cover: '',
        deleted: false,
        publish: false,
        publishTime: undefined,
        pinned: false,
        allowComment: true,
        visible: 'PUBLIC',
        priority: 0,
        excerpt: {
          autoGenerate: true,
          raw: '',
        },
        categories: [],
        tags: [],
        htmlMetas: [],
      },
      apiVersion: 'content.halo.run/v1alpha1',
      kind: 'Post',
      metadata: {
        name: randomUUID(),
        annotations: {},
      },
    },
    content: {
      raw: html,
      content: html,
      rawType: 'html',
    },
  };

  if (convertToMarkdown.value) {
    const markdown = turndownService.turndown(html);
    postToCreate.content!.raw = markdown;
    postToCreate.content!.content = html;
    postToCreate.content!.rawType = 'markdown';
  }

  const { data } = await consoleApiClient.content.post.draftPost({
    postRequest: postToCreate,
  });

  if (publishAfterImport.value) {
    await consoleApiClient.content.post.publishPost({
      name: data.metadata.name,
    });
  }
}

function handleClear() {
  importQueue.length = 0;
}

const showAlert = useSessionStorage('plugin:content-tools:word-import-alert', true);
</script>
<template>
  <div>
    <div v-if="showAlert" class=":uno: mb-5 w-full lg:w-1/2">
      <VAlert title="Tip" @close="showAlert = false">
        <template #description>
          <ul class=":uno: ml-2 list-disc list-inside space-y-1">
            <li>Due to the complexity of Word files, content formats may not be parsed perfectly. It is recommended to adjust manually after import.</li>
            <li>Supports importing image resources in Word files simultaneously, other resources are not supported yet.</li>
            <li>
              Images will be uploaded to the storage policy associated with the personal center, please set it in advance in
              <a class=":uno: text-gray-900 hover:text-gray-600" href="/console/settings?tab=user"
                >User Settings</a
              >
              .
            </li>
          </ul>
        </template>
      </VAlert>
    </div>
    <VSpace>
      <VButton :disabled="isBusy" @click="fileInput?.click()">Select Word Document</VButton>
      <VButton :disabled="isBusy" @click="folderInput?.click()">Select Word Document Folder</VButton>
      <VButton v-if="importQueue.length > 0" :disabled="isBusy" @click="handleClear">
        Clear Files
      </VButton>

      <input
        ref="fileInput"
        type="file"
        accept=".doc,.docx"
        multiple
        style="display: none"
        @change="onFilesSelected"
      />
      <input
        ref="folderInput"
        type="file"
        directory
        webkitdirectory
        style="display: none"
        @change="onFolderSelected"
      />
    </VSpace>

    <div class=":uno: mt-5">
      <FormKit
        v-model="convertToMarkdown"
        type="checkbox"
        label="Convert to Markdown Format"
        :disabled="isBusy"
        help="Format incompatibility issues may occur, use with caution"
      ></FormKit>
    </div>

    <div class=":uno: mt-3">
      <FormKit
        v-model="publishAfterImport"
        type="checkbox"
        label="Publish Article After Import"
        :disabled="isBusy"
        help="When unchecked, imported articles will be saved as drafts"
      ></FormKit>
    </div>

    <div v-if="importQueue.length > 0" class=":uno: mt-5 space-y-4">
      <div class=":uno: flex items-center justify-between">
        <div class=":uno: h-7 flex items-center gap-3 text-sm text-gray-600">
          <span>
            Total: <b class=":uno: text-gray-900">{{ queueStats.total }}</b>
          </span>
          <span>
            Pending:
            <b class=":uno: text-gray-900">{{ queueStats.pending }}</b>
          </span>
          <span>
            Processing:
            <b class=":uno: text-gray-900">{{ queueStats.processing }}</b>
          </span>
          <span>
            Success: <b class=":uno: text-gray-900">{{ queueStats.success }}</b>
          </span>
          <span>
            Failed:
            <b :class="{ ':uno: !text-red-500': queueStats.error > 0 }" class=":uno: text-gray-900">
              {{ queueStats.error }}
            </b>
          </span>
        </div>
        <VSpace>
          <VButton v-if="queueStats.error > 0" :disabled="isBusy" size="sm" @click="handleRetryAll">
            Retry All
          </VButton>
          <VButton
            type="secondary"
            :loading="isBusy"
            :disabled="queueStats.pending === 0"
            @click="handleStart"
          >
            Start Import
          </VButton>
        </VSpace>
      </div>

      <div class=":uno: rounded-base overflow-hidden border">
        <VEntityContainer>
          <VEntity v-for="item in importQueue" :key="item.id">
            <template #start>
              <VEntityField>
                <template #description>
                  <div class=":uno: flex items-center gap-2">
                    <MingcuteDocumentLine class=":uno: text-blue-500" />
                    <span class=":uno: text-sm text-gray-900">
                      {{ item.filename }}
                    </span>
                  </div>
                </template>
              </VEntityField>
            </template>
            <template #end>
              <VEntityField>
                <template #description>
                  <MingcuteLoading3Fill
                    v-if="item.status === 'processing'"
                    class=":uno: animate-spin"
                  />
                  <MingcuteCheckCircleFill
                    v-else-if="item.status === 'success'"
                    class=":uno: text-green-500"
                  />
                  <div
                    v-else-if="item.status === 'error'"
                    class=":uno: inline-flex items-center gap-2"
                  >
                    <MingcuteCloseCircleLine v-tooltip="item.error" class=":uno: text-red-500" />
                    <VButton size="sm" :disabled="isBusy" @click="retryItem(item)"> Retry </VButton>
                  </div>
                  <MingcuteTimeLine v-else class=":uno: text-gray-500" />
                </template>
              </VEntityField>
            </template>
          </VEntity>
        </VEntityContainer>
      </div>
    </div>

    <div v-else class=":uno: h-64 flex items-center justify-center text-sm text-gray-600">
      Please select the Word document or folder to import
    </div>
  </div>
</template>
