import { consoleApiClient, type ListedPost } from '@halo-dev/api-client';
import { Dialog, VDropdownDivider, VDropdownItem, VLoading } from '@halo-dev/components';
import { definePlugin } from '@halo-dev/console-shared';
import 'uno.css';
import { defineAsyncComponent, h, markRaw } from 'vue';
import MingcuteFileImportLine from '~icons/mingcute/file-import-line';
import PostCloneDropdownItem from './components/PostCloneDropdownItem.vue';

export default definePlugin({
  components: {},
  routes: [
    {
      parentName: 'ToolsRoot',
      route: {
        path: 'post-import',
        name: 'PostImport',
        component: defineAsyncComponent({
          loader: () => import('./views/PostImport.vue'),
          loadingComponent: VLoading,
        }),
        meta: {
          title: 'Article Import',
          description: 'Import Articles to Halo',
          searchable: true,
          permissions: ['*'],
          menu: {
            name: 'Article Import',
            icon: markRaw(MingcuteFileImportLine),
            priority: 0,
          },
        },
      },
    },
  ],
  extensionPoints: {
    'editor:create': async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const name = urlParams.get('name');

      if (!name) {
        return [];
      }

      const { data: content } = await consoleApiClient.content.post.fetchPostHeadContent(
        {
          name: name,
        },
        { mute: true }
      );

      return [
        {
          name: 'content-converter',
          displayName: 'Content Format Converter',
          logo: '/plugins/content-tools/assets/icon.svg',
          component: defineAsyncComponent({
            loader: () => import('./components/ConverterEditor.vue'),
            loadingComponent: VLoading,
          }),
          rawType: content.rawType || 'html',
        },
      ];
    },
    // @ts-expect-error don't important
    // Needs upstream to fix this issue
    'post:list-item:operation:create': (post: ListedPost) => {
      return [
        {
          priority: 21,
          component: markRaw(VDropdownDivider),
        },
        {
          priority: 22,
          component: markRaw(VDropdownItem),
          label: 'Convert',
          visible: true,
          children: [
            {
              priority: 0,
              component: markRaw(VDropdownItem),
              label: 'Convert to Rich Text Format',
              visible: true,
              action: async (post: ListedPost) => {
                Dialog.warning({
                  title: 'Convert to Rich Text Format',
                  description:
                    'Converting Markdown to Rich Text Format does not guarantee full compatibility. It is recommended to check the content after conversion for completeness. If there are issues, you can find the previous version in the version history.',
                  onConfirm: async () => {
                    const { PostOperations } = await import('./class/postOperations');
                    await PostOperations.convertContent(post.post, 'html');
                  },
                });
              },
            },
            {
              priority: 1,
              component: markRaw(VDropdownItem),
              label: 'Convert to Markdown Format',
              visible: true,
              action: async (post: ListedPost) => {
                Dialog.warning({
                  title: 'Convert to Markdown Format',
                  description:
                    'Converting Rich Text Format to Markdown Format does not guarantee full compatibility. It is recommended to check the content after conversion for completeness. If there are issues, you can find the previous version in the version history.',
                  onConfirm: async () => {
                    const { PostOperations } = await import('./class/postOperations');
                    await PostOperations.convertContent(post.post, 'markdown');
                  },
                });
              },
            },
          ],
        },
        {
          priority: 23,
          component: defineAsyncComponent({
            loader: () => import('./components/PostExportDropdownItem.vue'),
            loadingComponent: h(VDropdownItem, { disabled: true }, '加载中'),
          }),
          props: {
            post: post,
          },
        },
        {
          priority: 24,
          component: markRaw(VDropdownItem),
          label: 'Copy Article Content',
          visible: true,
          permissions: ['system:posts:view'],
          children: [
            {
              priority: 0,
              component: markRaw(VDropdownItem),
              label: 'Copy in Original Format',
              visible: true,
              action: async (post: ListedPost) => {
                const { default: PostContentCopier } = await import('./class/postContentCopier');
                await PostContentCopier.copyPostContent(post.post, {
                  convertToMarkdown: false,
                });
              },
            },
            {
              priority: 1,
              component: markRaw(VDropdownItem),
              label: 'Convert to Markdown and Copy',
              visible: true,
              action: async (post: ListedPost) => {
                const { default: PostContentCopier } = await import('./class/postContentCopier');
                await PostContentCopier.copyPostContent(post.post, {
                  convertToMarkdown: true,
                });
              },
            },
          ],
        },
        {
          priority: 25,
          component: markRaw(PostCloneDropdownItem),
          props: {
            post: post,
          },
        },
      ];
    },
  },
});
