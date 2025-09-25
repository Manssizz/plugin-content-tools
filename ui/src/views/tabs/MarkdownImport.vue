<script lang="ts" setup>
import { getCategoryNamesByDisplayNames } from '@/utils/category';
import { randomUUID } from '@/utils/id';
import { extractImageReferences, isImageFile } from '@/utils/image';
import { convertPostContentToHTML } from '@/utils/markdown';
import { readMatter } from '@/utils/matter';
import { getTagNamesByDisplayNames } from '@/utils/tag';
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
import PQueue from 'p-queue';
import { computed, reactive, ref } from 'vue';
import MingcuteCheckCircleFill from '~icons/mingcute/check-circle-fill';
import MingcuteCloseCircleLine from '~icons/mingcute/close-circle-line';
import MingcuteLoading3Fill from '~icons/mingcute/loading-3-fill';
import MingcuteMarkdownLine from '~icons/mingcute/markdown-line';
import MingcuteTimeLine from '~icons/mingcute/time-line';

const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const convertToHtml = ref(false);
const publishAfterImport = ref(true);

interface ImportItem {
  id: string;
  file: File;
  filename: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
}

const importQueue = reactive<ImportItem[]>([]);
const imageFiles = reactive<File[]>([]);
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
    imageCount: imageFiles.length,
  };
});

const isBusy = computed(() => {
  return queueStats.value.processing > 0;
});

async function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

function onFilesSelected(event: Event) {
  const files = (event.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type === 'text/markdown' || file.name.endsWith('.md')) {
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

    if (file.type === 'text/markdown' || file.name.endsWith('.md')) {
      if (!existingFileNames.has(file.name)) {
        importQueue.push({
          id: randomUUID(),
          file,
          filename: file.name,
          status: 'pending',
        });
        existingFileNames.add(file.name);
      }
    } else if (isImageFile(file)) {
      imageFiles.push(file);
    }
  }

  if (folderInput.value) folderInput.value.value = '';
}

function onImageFolderSelected(event: Event) {
  const files = (event.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  imageFiles.length = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isImageFile(file)) {
      imageFiles.push(file);
    }
  }

  if (imageInput.value) imageInput.value.value = '';
}

function findMatchingImageFile(imagePath: string): File | undefined {
  const fileName = imagePath.split('/').pop() || imagePath;

  return imageFiles.find((file) => {
    return file.name === fileName || file.name.endsWith(fileName) || fileName.endsWith(file.name);
  });
}

async function uploadImageFile(imageFile: File): Promise<Attachment> {
  try {
    const imageBlob = await imageFile.arrayBuffer();
    const { data } = await ucApiClient.storage.attachment.createAttachmentForPost({
      file: new File([imageBlob], imageFile.name, { type: imageFile.type }),
      waitForPermalink: true,
    });

    return data;
  } catch (error) {
    console.error('Failed to upload image:', error);
    throw error;
  }
}

async function processMarkdownImages(markdownContent: string): Promise<string> {
  if (imageFiles.length === 0) {
    return markdownContent;
  }

  const imageReferences = extractImageReferences(markdownContent);
  let processedContent = markdownContent;

  for (const imagePath of imageReferences) {
    let matchedImageFile = findMatchingImageFile(imagePath);

    // if not found, try to decode the image path
    if (!matchedImageFile) {
      matchedImageFile = findMatchingImageFile(decodeURIComponent(imagePath));
    }

    if (matchedImageFile) {
      try {
        const attachment = await uploadImageFile(matchedImageFile);

        const escapedImagePath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedImagePath}\\)`, 'g');
        processedContent = processedContent.replace(
          regex,
          `![$1](${attachment.status?.permalink})`
        );
      } catch (error) {
        console.warn(`Failed to upload image ${imagePath}:`, error);
      }
    }
  }

  return processedContent;
}

async function processItem(item: ImportItem): Promise<void> {
  item.status = 'processing';

  try {
    const raw = await readFileContent(item.file);

    await createPost(item, raw);
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

async function createPost(item: ImportItem, raw: string) {
  const processedRaw = await processMarkdownImages(raw);

  const fileName = item.file.name.replace(/\.md$/, '');

  const parsedMatter = readMatter(processedRaw);

  const matterData = parsedMatter.data as {
    title: string;
    slug: string;
    description: string;
    excerpt: string;
    categories?: string[];
    tags?: string[];
  };

  const html = convertPostContentToHTML({
    raw: parsedMatter.content,
    content: '',
    rawType: 'markdown',
  });

  const finalExcerpt = matterData.excerpt || matterData.description;

  const categoryNames = await getCategoryNamesByDisplayNames(matterData.categories);
  const tagNames = await getTagNamesByDisplayNames(matterData.tags);

  const postToCreate: PostRequest = {
    post: {
      spec: {
        title: matterData.title || fileName,
        slug: matterData.slug || fileName.toLowerCase().replace(/\s+/g, '-'),
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
          autoGenerate: !!finalExcerpt,
          raw: finalExcerpt,
        },
        categories: categoryNames,
        tags: tagNames,
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
      raw: convertToHtml.value ? html : parsedMatter.content,
      content: html,
      rawType: convertToHtml.value ? 'html' : 'markdown',
    },
  };

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

function handleClearImages() {
  imageFiles.length = 0;
}

const showAlert = useSessionStorage('plugin:content-tools:markdown-import-alert', true);
</script>
<template>
  <div>
    <div v-if="showAlert" class=":uno: mb-5 w-full lg:w-1/2">
      <VAlert title="Tip" @close="showAlert = false">
        <template #description>
          <ul class=":uno: ml-2 list-disc list-inside space-y-1">
            <li>
              Importing Markdown files supports importing associated images at the same time, you can choose a folder that contains both Markdown
              files and images.
            </li>
            <li>
              Images will be uploaded to the storage policy associated with the personal center, please set it in advance in
              <a class=":uno: text-gray-900 hover:text-gray-600" href="/console/settings?tab=user"
                >User Settings</a
              >
              .
            </li>
            <li>
              Supports parsing Markdown Front Matter data, including
              title, slug, description, excerpt, categories, tags.
            </li>
            <li>Due to platform differences, some Markdown syntax may not be supported.</li>
          </ul>
        </template>
      </VAlert>
    </div>
    <VSpace>
      <VButton :disabled="isBusy" @click="fileInput?.click()">Select Markdown File</VButton>
      <VButton :disabled="isBusy" @click="folderInput?.click()">Select Markdown Folder</VButton>
      <VButton :disabled="isBusy" @click="imageInput?.click()"> Select Image Folder </VButton>
      <VButton v-if="importQueue.length > 0" :disabled="isBusy" @click="handleClear">
        Clear Files
      </VButton>
      <VButton v-if="imageFiles.length > 0" :disabled="isBusy" @click="handleClearImages">
        Clear Images
      </VButton>

      <input
        ref="fileInput"
        type="file"
        accept=".md"
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
      <input
        ref="imageInput"
        type="file"
        webkitdirectory
        style="display: none"
        @change="onImageFolderSelected"
      />
    </VSpace>

    <div class=":uno: mt-5">
      <FormKit
        v-model="convertToHtml"
        type="checkbox"
        label="Convert to Rich Text Format"
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
          <span v-if="queueStats.imageCount > 0" class=":uno: text-blue-600">
            Images: <b>{{ queueStats.imageCount }}</b>
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
                    <MingcuteMarkdownLine class=":uno: text-blue-500" />
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
      Please select the Markdown file or folder to import
    </div>
  </div>
</template>
