<script setup lang="ts">
import ConverterManager, { type ConversionOption } from '@/class/converterManager';
import {
  consoleApiClient,
  coreApiClient,
  type ContentWrapper,
  type Post,
} from '@halo-dev/api-client';
import { Dialog, Toast } from '@halo-dev/components';
import { useRouteQuery } from '@vueuse/router';
import { onMounted, ref } from 'vue';

const converterManager = ConverterManager.getInstance();

const converterOptions = ref<ConversionOption[]>([]);
const name = useRouteQuery<string | undefined>('name');

const post = ref<Post | undefined>();
const content = ref<ContentWrapper | undefined>();

onMounted(async () => {
  if (!name.value) {
    Toast.warning('No article is currently created, cannot use conversion function');
    return;
  }

  const { data: currentPost } = await coreApiClient.content.post.getPost({
    name: name.value,
  });

  post.value = currentPost;

  const { data: latestContent } = await consoleApiClient.content.post.fetchPostHeadContent({
    name: name.value,
  });

  content.value = latestContent;

  if (!content.value.rawType) {
    Toast.success('Current article content or type does not exist');
    return;
  }

  converterOptions.value = converterManager.getConverterOptions(content.value.rawType);
});

async function handleConvert(option: ConversionOption) {
  Dialog.warning({
    title: option.label,
    description:
      'Format conversion does not guarantee full compatibility. It is recommended to check the content after conversion for completeness. If there are issues, you can find the previous version in the version history.',
    onConfirm: async () => {
      if (!post.value) {
        return;
      }

      const { PostOperations } = await import('@/class/postOperations');

      await PostOperations.convertContent(post.value, option.toType);

      localStorage.removeItem('editor-provider-name');

      Toast.success('Conversion completed');

      setTimeout(() => {
        window.location.reload();
      }, 200);
    },
  });
}
</script>
<template>
  <div class=":uno: bg-white">
    <div class=":uno: size-full flex flex-col items-center pt-20">
      <div>
        <h2 class=":uno: text-2xl font-medium">Content Format Converter</h2>
        <p class=":uno: mt-4 text-sm text-gray-600">Please select the format you want to convert to:</p>
        <ul class=":uno: mt-4 space-y-2">
          <li v-for="option in converterOptions" :key="option.toType + option.fromType">
            <button
              class=":uno: hover:border-primary w-96 border rounded-md p-2 text-sm text-gray-600 transition-all hover:text-gray-900"
              @click="handleConvert(option)"
            >
              {{ option.label }}
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
