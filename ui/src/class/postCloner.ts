import { randomUUID } from '@/utils/id';
import {
  consoleApiClient,
  type ContentWrapper,
  type Post,
  type PostRequest,
} from '@halo-dev/api-client';
import { Toast } from '@halo-dev/components';
import { cloneDeep } from 'es-toolkit';
import { set } from 'es-toolkit/compat';

class PostCloner {
  static async clonePost(post: Post): Promise<void> {
    try {
      const originalContent = await this.fetchPostContent(post.metadata.name);

      const newPostData = this.prepareNewPostData(post, originalContent);

      await consoleApiClient.content.post.draftPost({
        postRequest: newPostData,
      });

      Toast.success('Article cloned successfully. If the list does not refresh, please refresh manually.');
    } catch (error) {
      console.error('Failed to clone post', error);
      Toast.error('Failed to clone article');
    }
  }

  private static async fetchPostContent(postName: string): Promise<ContentWrapper> {
    const { data } = await consoleApiClient.content.post.fetchPostHeadContent({
      name: postName,
    });

    return data;
  }

  private static prepareNewPostData(originalPost: Post, content: ContentWrapper): PostRequest {
    const postToCreate = cloneDeep(originalPost);
    set(postToCreate, 'spec.baseSnapshot', '');
    set(postToCreate, 'spec.headSnapshot', '');
    set(postToCreate, 'spec.releaseSnapshot', '');
    set(postToCreate, 'spec.slug', `${originalPost.spec.slug}-${randomUUID().split('-')[0]}`);
    set(postToCreate, 'spec.title', originalPost.spec.title + ' (Copy)');
    set(postToCreate, 'spec.publish', false);
    set(postToCreate, 'metadata', {
      name: randomUUID(),
    });

    return {
      post: postToCreate,
      content: content,
    };
  }
}

export default PostCloner;
