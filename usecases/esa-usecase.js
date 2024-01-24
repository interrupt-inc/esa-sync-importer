const fs = require('fs');
const {
  glob,
} = require('glob');
const {createClient} = require("@suin/esa-api");
const path = require("path");

class EsaUsecase {

  constructor() {

    if (!process.env.ESA_ACCESS_TOKEN) {
      throw new Error('ESA_ACCESS_TOKEN is not set');
    }

    this.client = createClient({
      token: process.env.ESA_ACCESS_TOKEN,
    });

  }

  /**
   * 同期を行う
   * @param source {string} 同期元のディレクトリ
   * @param destination {string} 同期先のディレクトリ
   * @param team {string} 同期先のチーム名
   * @param wip {boolean} WIP状態で投稿するかどうか
   * @param dryRun {boolean} Dry Runモードによる実行かどうか
   */
  async sync({source, destination, options: {team, wip, dryRun}}) {

    // ディレクトリ存在チェック
    if (!fs.existsSync(source)) {
      throw new Error(`source directory "${source}" does not exist`);
    }

    // 出力先ディレクトリ存在チェック
    if (!destination) {
      throw new Error(`destination directory "${destination}" is empty`);
    }

    // チーム名存在チェック
    if (!team) {
      throw new Error(`team name "${team}" is empty`);
    }
    // ディレクトリから.txtか.mdのファイルを取得
    const files = await glob(`${source}/**/*.{txt,md}`, {
      ignore: ['**/node_modules/**', '**/log/**', '**/logs/**', '**/tmp/**']
    });

    for (const file of files) {
      await this.syncFile({file, source, destination, team, wip, dryRun});
    }
  }

  async syncFile({file, source, destination, team, wip, dryRun}) {

    const _title = `${
      this.replaceFirst(file, source, '')
        .replace(/\.(txt|md)$/, '')
        .replace(/^\//, '')
        .trim()
    }`
      .replaceAll('//', '/');

    const longTitle = `${destination.replace(/\/$/, '')}/${_title}`;
    const category = path.dirname(longTitle);
    const title = path.basename(longTitle);

    console.debug('title =', title, '/ category =', category);

    const body = fs.readFileSync(file, 'utf8');

    if (dryRun) {
      console.debug(`dry run: ${category}/${title}`);
      return;
    }

    // すでに同じタイトルの記事があるかどうかをチェックする
    const q = `on:"${category}" name:"${title}"`;
    console.debug('q =', q);
    const existingResponse = await this.client.getPosts({
      teamName: team,
      q,
      perPage: 1,
    });

    const rateLimitRemainingOfExisting = existingResponse.headers['x-ratelimit-remaining'];
    const rateLimitResetOfExisting = existingResponse.headers['x-ratelimit-reset'];
    const ratelimitLimitOfExisting = existingResponse.headers['x-ratelimit-limit'];

    if ( existingResponse?.status === 429 ) {
      // 再試行する
      const waitTime = Math.ceil((rateLimitResetOfExisting - Date.now() / 1000) / rateLimitRemainingOfExisting);
      console.debug(`rate limit exceeded. wait for ${waitTime} seconds. remaining ${rateLimitRemainingOfExisting} / ${ratelimitLimitOfExisting}`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      await this.syncFile({file, source, destination, team, wip});
      return
    }

    if (existingResponse?.status !== 200) {
      throw new Error('failed to get post with status code ' + existingResponse?.status + ' / ' + existingResponse?.data?.message);
    }
    if ((existingResponse?.data?.posts?.length ?? 0) > 0) {

      console.debug('this post is already exists. post: ', existingResponse.data.posts[0].name);

      const waitTime = Math.ceil((rateLimitResetOfExisting - Date.now() / 1000) / rateLimitRemainingOfExisting);
      console.debug(`wait for ${waitTime} seconds. remaining ${rateLimitRemainingOfExisting} / ${ratelimitLimitOfExisting}`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      const postId = existingResponse?.data?.posts[0]?.number;

      if (!postId) {
        throw new Error('postId is empty');
      }

      await this.updateFile({postId, title, body, team, wip});
      return
    }

    // 記事を新規投稿する
    const response = await this.client.createPost({
      teamName: team,
      post: {
        name: title,
        body_md: body,
        tags: [],
        category,
        wip: wip || false,
        message: "sync from esa sync importer",
      },
    });

    // 現時点では、ユーザ毎に15分間に75リクエストまで受け付けます。
    // https://docs.esa.io/posts/102#%E5%88%A9%E7%94%A8%E5%88%B6%E9%99%90
    const rateLimitRemaining = response.headers['x-ratelimit-remaining'];
    const rateLimitReset = response.headers['x-ratelimit-reset'];
    const ratelimitLimit = response.headers['x-ratelimit-limit'];
    const waitTime = Math.ceil((rateLimitReset - Date.now() / 1000) / rateLimitRemaining);

    if (response?.status === 429) {
      // 再試行する
      console.debug(`rate limit exceeded. wait for ${waitTime} seconds. remaining ${rateLimitRemaining} / ${ratelimitLimit}`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      await this.syncFile({file, source, destination, team, wip});
      return
    }

    if (response?.status !== 201) {
      throw new Error('failed to create post with status code ' + response?.status + ' / ' + response?.data?.message);
    }

    console.debug('added post: ', response.data.name);

    // 上記3つの変数によってレートリミットを消化し尽くさない時間調整を行う計算式
    console.debug(`wait for ${waitTime} seconds. remaining ${rateLimitRemaining} / ${ratelimitLimit}`);
    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
  }

  /**
   * 記事を更新する
   * @param postId {string}
   * @param title {string}
   * @param body {string}
   * @param team {string}
   * @param wip {boolean}
   */
  async updateFile({postId, title, body, team, wip}) {

    const response = await this.client.updatePost({
      teamName: team,
      postNumber: postId,
      updatePostBody: {
        post: {
          name: title,
          wip: wip || false,
          message: "sync from esa sync importer",
          tags: [],
          body_md: body,
        },
      },
      postId,
    });

    const rateLimitRemaining = response.headers['x-ratelimit-remaining'];
    const rateLimitReset = response.headers['x-ratelimit-reset'];
    const ratelimitLimit = response.headers['x-ratelimit-limit'];
    const waitTime = Math.ceil((rateLimitReset - Date.now() / 1000) / rateLimitRemaining);

    if (response?.status === 429) {
      // 再試行する
      console.debug(`rate limit exceeded. wait for ${waitTime} seconds. remaining ${rateLimitRemaining} / ${ratelimitLimit}`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      await this.updateFile({postId, title, body, team, wip});
      return
    }

    if (response?.status !== 200) {
      throw new Error('failed to update post with status code ' + response?.status + ' / ' + response?.data?.message);
    }

    console.debug('update post: ', response.data.name);

    // 上記3つの変数によってレートリミットを消化し尽くさない時間調整を行う計算式
    console.debug(`wait for ${waitTime} seconds. remaining ${rateLimitRemaining} / ${ratelimitLimit}`);
    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

  }

  /**
   * 先頭一致で置換する
   * @param str {string}
   * @param search {string}
   * @param replace {string}
   * @returns {string}
   */
  replaceFirst(str, search, replace) {
    const index = str.indexOf(search);
    if (index === -1) {
      return str;
    }
    return str.slice(0, index) + replace + str.slice(index + search.length);
  }
}

module.exports = {
  EsaUsecase: EsaUsecase
}
