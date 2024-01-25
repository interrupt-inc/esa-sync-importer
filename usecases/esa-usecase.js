const fs = require('fs');
const {
  glob,
} = require('glob');
const { createClient } = require("@suin/esa-api");
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
  async sync({ source, destination, options: { team, wip, dryRun, ignoreExisting } }) {

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
    const files = (await glob(`${source}/**/*.{txt,md}`, {
      ignore: [ '**/node_modules/**', '**/log/**', '**/logs/**', '**/tmp/**' ]
    })).sort((a, b) => {
      // 更新順にソート(降順)
      return fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime();
    });

    const alreadyExistPosts = ignoreExisting ? await this.getPosts({ destination, team }) : [];

    for ( const file of files ) {
      const { name, category } = this.formatName({ file, source, destination });
      if (alreadyExistPosts.find(post => post.name === name && post.category === category)) {
        console.debug('this post is already exists. post: ', `${category}/${name}`);
        continue;
      }
      await this.syncFile({ file, source, destination, team, wip, dryRun });
    }
  }

  async syncFile({ file, source, destination, team, wip, dryRun }) {

    const { category, name } = this.formatName({ file, source, destination });

    console.debug('name =', name, '/ category =', category);

    const body = fs.readFileSync(file, 'utf8');

    if (dryRun) {
      console.debug(`dry run: ${category}/${name}`);
      return;
    }

    // すでに同じタイトルの記事があるかどうかをチェックする
    const q = `on:"${category}" name:"${name}"`;
    console.debug('q =', q);
    const existingResponse = await this.client.getPosts({
      teamName: team,
      q,
      perPage: 1,
    }).catch(error => error);

    if (existingResponse?.response?.status === 429) {
      await this.waitRateLimit({ response: existingResponse });
      await this.syncFile({ file, source, destination, team, wip });
      return
    }

    if (existingResponse?.status !== 200) {
      console.debug('existingResponse =', existingResponse);
      throw new Error(
        `failed to get post with status code ${existingResponse?.response?.status} / ${existingResponse?.response?.data?.message}`);
    }
    if ((existingResponse?.data?.posts?.length ?? 0) > 0) {

      console.debug('this post is already exists. post: ', existingResponse.data.posts[0].name);

      await this.waitRateLimit({ response: existingResponse });
      const postId = existingResponse?.data?.posts[0]?.number;

      if (!postId) {
        throw new Error('postId is empty');
      }

      await this.updateFile({ postId, name, body, team });
      return
    }

    // 記事を新規投稿する
    const response = await this.client.createPost({
      teamName: team,
      post: {
        name,
        body_md: body,
        tags: [],
        category,
        wip: wip || false,
        message: "sync from esa sync importer",
      },
    }).catch(error => error);

    if (response?.response?.status === 429 || response?.status === 429) {
      await this.waitRateLimit({ response });
      await this.syncFile({ file, source, destination, team, wip });
      return
    }

    if (response?.status !== 201) {
      console.debug('response =', response);
      throw new Error('failed to create post with status code ' + response?.response?.status + ' / ' + response?.response?.data?.message);
    }

    console.debug('added post: ', response.data.full_name);
    await this.waitRateLimit({ response });
  }


  /**
   * 投稿一覧を取得する
   * @param files
   * @param destination
   * @param team
   * @returns {Promise<{ name: string, category: string }[]>}
   */
  async getPosts({ destination, team }) {
    const posts = [];
    let page = 1;

    while ( true ) {
      const response = await this.client.getPosts({
        teamName: team,
        q: `in:"${destination.replace(/\/$/, '')}"`,
        perPage: 100,
        page,
      }).catch(error => error);

      if (response?.response?.status === 429 || response?.status === 429) {
        await this.waitRateLimit({ response });
        continue;
      }

      if (response?.status !== 200) {
        console.debug('response =', response);
        throw new Error('failed to get post with status code ' + response?.response?.status + ' / ' + response?.response?.data?.message);
      }

      if (response?.data?.posts?.length === 0) {
        await this.waitRateLimit({ response });
        break;
      }

      response.data.posts.forEach(post => {
        posts.push({ name: post.name, category: post.category });
      });

      await this.waitRateLimit({ response, message: `current page index: ${page}` });
      if (response.data.posts.length < 100) {
        break;
      }
      page++;
    }
    return posts;
  }

  /**
   * 記事を更新する
   * @param postId {string}
   * @param name {string}
   * @param body {string}
   * @param team {string}
   */
  async updateFile({ postId, name, body, team }) {

    const response = await this.client.updatePost({
      teamName: team,
      postNumber: postId,
      updatePostBody: {
        post: {
          name,
          message: "sync from esa sync importer",
          tags: [],
          body_md: body,
        },
      },
      postId,
    }).catch(error => error);

    if (response?.response?.status === 429 || response?.status === 429) {
      await this.waitRateLimit({ response });
      await this.updateFile({ postId, name, body, team });
      return
    }

    if (response?.status !== 200) {
      console.debug('response =', response);
      throw new Error('failed to update post with status code ' + response?.response?.status + ' / ' + response?.response?.data?.message);
    }
    console.debug('updated post: ', response.data.full_name);
    await this.waitRateLimit({ response });
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

  /**
   * 件名の整形
   * @param file {string}
   * @param source {string}
   * @param destination {string}
   * @returns {{longTitle: string, category: string, name: string}}
   */
  formatName({ file, source, destination }) {
    const _name = `${
      this.replaceFirst(file, source, '')
        .replace(/\.(txt|md)$/, '')
        .replace(/^\//, '')
        .trim()
    }`
      .replaceAll('//', '/');

    const fullName = `${destination.replace(/\/$/, '')}/${_name}`;
    const category = path.dirname(fullName);
    const name = path.basename(fullName);

    return { fullName, category, name };
  }

  /**
   * レートリミットの待機
   * 現時点では、ユーザ毎に15分間に75リクエストまで受け付けます。
   * https://docs.esa.io/posts/102#%E5%88%A9%E7%94%A8%E5%88%B6%E9%99%90
   */
  async waitRateLimit({ response, message }) {
    const rateLimitRemaining = response.headers['x-ratelimit-remaining'];
    const rateLimitReset = response.headers['x-ratelimit-reset'];
    const ratelimitLimit = response.headers['x-ratelimit-limit'];
    const waitTimeDecimal = (rateLimitReset - Date.now() / 1000) / rateLimitRemaining;
    const waitTime = Math.ceil(waitTimeDecimal);
    if (response.status === 429) {
      console.debug(
        `rate limit exceeded. wait for ${waitTime} seconds. remaining ${rateLimitRemaining} / ${ratelimitLimit}`);
    } else {
      console.debug(`${message ? message + '. ' :
        ''}wait for ${waitTime} seconds. remaining ${rateLimitRemaining} / ${ratelimitLimit}`);
    }
    return new Promise(resolve => setTimeout(resolve, waitTimeDecimal * 1000));
  }

}

module.exports = {
  EsaUsecase: EsaUsecase
}
