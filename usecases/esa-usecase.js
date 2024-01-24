const fs = require('fs');
const {
  glob,
} = require('glob');
const {createClient} = require("@suin/esa-api");

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

    const title = `${
      this.replaceFirst(file, source, '')
        .replace(/\.(txt|md)$/, '')
        .replace(/^\//, '')
        .trim()
    }`
      .replaceAll('//', '/');

    const body = fs.readFileSync(file, 'utf8');

    if (dryRun) {
      console.debug(`dry run: ${destination.replace(/\/$/, '')}/${title}`);
      return;
    }

    // 記事を新規投稿する
    const response = await this.client.createPost({
      teamName: team,
      post: {
        name: title,
        body_md: body,
        tags: [],
        category: destination.replace(/\/$/, ''),
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
